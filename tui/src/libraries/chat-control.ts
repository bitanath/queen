// Chat controller for the dashboard: owns the Strands agent, conversation,
// streaming, tool-call tracking and slash-command handling. The presentational
// `Chat` view lives in ../chat.tsx; this module is JSX-free so it can sit in
// libraries/.

import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useRef, useState } from "react";

import {
  getActivity,
  getChanged,
  getInsights,
  getLocations,
  getMe,
  getNow,
  getStatus,
  getTodayBrief,
  getTodayContext,
  isLoggedIn,
  isNotLoggedIn,
  listConversations,
  listDailySummaries,
  listFacts,
  listJournals,
  loginWithToken,
  logout,
  pollPairing,
  renderStatusMd,
  searchBee,
  startPairing,
  type CommandResult,
} from "../utils/bee-com-bridge";
import type { AnswerView } from "../utils/answer-view";
import { EngineCancelled, OFFLINE_NOTICE, streamFallback } from "../utils/queen-ffi";
import { lastThink, stripThinking } from "../utils/stream-status";
import { ElthurModel } from "../functions/strands-model";
import { agentModels, createQueenAgent, type SpecialistEvent } from "../functions/tools-execution";
import { AGENT_SPECS } from "../functions/agents";
import { stripToolMarkup } from "../functions/tool-definitions";
import { modelAvailable } from "../functions/model-params";
import { useUi } from "../userinterface";
import { useMcp } from "../mcproviders";
import type { ToolCallStatus } from "../components/tool-call";

export type Role = "user" | "queen" | "error" | "system";

export type ToolCallView = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  duration?: number;
  startedAt: number;
};

export type ChatMessage = { id: number; role: Role; text: string; tools?: ToolCallView[] };

// Banner status for the current turn. Kept in the engine because it depends on
// event ordering (thinking vs tool result) that only the stream loop sees.
export type ChatPhase =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "tool"; tool: string }
  | { kind: "working"; label: string; detail: string }
  | { kind: "done" };

export type ChatController = {
  msgs: ChatMessage[];
  streamingId: number | null;
  busy: boolean;
  phase: ChatPhase;
  ready: boolean;
  loggedIn: boolean | null;
  send: (line: string) => Promise<void>;
  cancel: () => void;
  context: { used: number; active: string | null; activeUsed: number };
  /** Live feed from the active specialist subagent (thinking + current tool). */
  specialist: { name: string | null; tool: string | null; text: string; visible: boolean };
  /** The final answer of the last turn (whitespace preserved for markdown). */
  finalAnswer: string;
  /** Structured answer view for the last turn, when it was a command result. */
  answerView: AnswerView | null;
  /** Increments once per completed answer, so the UI can react to new ones. */
  answerSeq: number;
};

const AGENT_NAMES = new Set(AGENT_SPECS.map((spec) => spec.name));

function toolResultText(content: readonly { type: string; text?: string; json?: unknown }[]): string {
  return content
    .map((item) =>
      item.type === "textBlock"
        ? (item.text ?? "")
        : item.type === "jsonBlock"
          ? JSON.stringify(item.json, null, 2)
          : "",
    )
    .filter((s) => s.length > 0)
    .join("\n");
}

// MARK: - Chat engine. Owns the Strands agent, conversation, streaming and command handling.
export function useChat(): ChatController {
  const renderer = useRenderer();
  const ui = useUi();
  const [msgs, setMsgs] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "system",
      text: modelAvailable()
        ? "Welcome to queen. Type /help for commands, /login to connect Bee."
        : "Welcome to queen-lite. Commands only (no model) — type /help to see them.",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ChatPhase>({ kind: "idle" });
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [context, setContext] = useState<{ used: number; active: string | null; activeUsed: number }>({
    used: 0,
    active: null,
    activeUsed: 0,
  });
  // Live specialist (subagent) feed, surfaced in the dashboard while it runs.
  const [specialist, setSpecialist] = useState<{
    name: string | null;
    tool: string | null;
    text: string;
    visible: boolean;
  }>({ name: null, tool: null, text: "", visible: false });

  const handleSpecialist = (event: SpecialistEvent) => {
    setSpecialist((s) => {
      if (event.kind === "tool") return { ...s, name: event.agent, tool: event.tool, visible: true };
      const text = s.name === event.agent ? s.text + event.text : event.text;
      return { ...s, name: event.agent, text, visible: true };
    });
  };

  // Final answer of the last turn: thinking + tool markup stripped, whitespace
  // preserved so it can be rendered as markdown in the answer modal.
  const [finalAnswer, setFinalAnswer] = useState("");
  const [answerView, setAnswerView] = useState<AnswerView | null>(null);
  const [answerSeq, setAnswerSeq] = useState(0);
  const toAnswer = (raw: string) => stripToolMarkup(stripThinking(raw)).trim();
  // `null` = not yet probed, so a logged-in boot doesn't flash "Not Logged In".
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const idRef = useRef(1);
  const cancelRef = useRef(false);
  const pendingInterruptsRef = useRef<{ id: string; reason?: unknown }[] | null>(null);

  // MARK: - One Strands agent per chat pane. Built once the Bee MCP server has
  // loaded its tools so the registry-backed agents receive them.
  const mcp = useMcp();
  const [ready, setReady] = useState(false);
  const modelRef = useRef<ElthurModel | null>(null);
  const agentRef = useRef<ReturnType<typeof createQueenAgent> | null>(null);
  useEffect(() => {
    if (agentRef.current !== null || !mcp.ready) return;
    if (!modelAvailable()) {
      // queen-lite: no GGUF baked in, so never build an agent or touch inference.
      setReady(true);
      return;
    }
    const model = new ElthurModel();
    modelRef.current = model;
    // TODO: agent.toolRegistry.add(createDashboardTool(...)) once the dashboard is agent-driven.
    agentRef.current = createQueenAgent(model, handleSpecialist);
    setReady(true);
  }, [mcp.ready]);

  // Probe Bee login once on mount so the dashboard can point logged-out users at /login.
  useEffect(() => {
    isLoggedIn()
      .then((yes) => setLoggedIn(yes))
      .catch(() => setLoggedIn(false));
  }, []);

  const push = (role: Role, text: string, view: AnswerView | null = null) => {
    const id = idRef.current++;
    setMsgs((m) => [...m, { id, role, text }]);
    // Command replies (e.g. /me, /today) are finished answers too.
    if (role === "queen" && text.trim()) {
      setFinalAnswer(toAnswer(text));
      setAnswerView(view);
      setAnswerSeq((n) => n + 1);
    }
  };

  // FIXME Streaming queen reply: placeholder first, then live text updates.
  const pushStreaming = () => {
    const id = idRef.current++;
    setMsgs((m) => [...m, { id, role: "queen", text: "" }]);
    setStreamingId(id);
    return id;
  };

  const updateMsg = (id: number, text: string) => {
    setMsgs((m) => m.map((msg) => (msg.id === id ? { ...msg, text } : msg)));
  };

  const updateTools = (id: number, tools: ToolCallView[]) => {
    setMsgs((m) => m.map((msg) => (msg.id === id ? { ...msg, tools: tools.map((t) => ({ ...t })) } : msg)));
  };

  const quit = () => {
    renderer.destroy();
    process.exit(0);
  };

  const cancel = () => {
    cancelRef.current = true;
    agentRef.current?.cancel();
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") quit();
    if (ui.modalOpen) return; // a modal owns esc and friends while it is open
    if (key.name === "escape") cancel();
  });

  const streamAgent = async (text: string, pending?: { id: string; reason?: unknown }[]) => {
    const agent = agentRef.current;
    const model = modelRef.current;
    if (!agent || !model) return;
    const id = pushStreaming();
    const segments: string[] = [];
    const tools: ToolCallView[] = [];
    let live = "";
    let ok = true; // false when the turn errored or was cancelled (no final answer)
    // Text length at the last tool result: any think block after this point is
    // "fresh" and releases the Tool-call hold.
    let thinkMark = 0;
    const render = () => updateMsg(id, [...segments, live].filter((s) => s.trim().length > 0).join("\n\n"));
    try {
      // MARK: - One turn agentic loop let's goo
      const args =
        pending && pending.length > 0
          ? pending.map((p) => ({ interruptResponse: { interruptId: p.id, response: text } }))
          : text;
      const iterator = agent.stream(args);
      let step = await iterator.next();
      while (!step.done) {
        const event = step.value;
        if (event.type === "beforeToolCallEvent") {
          const name = event.toolUse.name;
          const args = (event.toolUse.input ?? {}) as Record<string, unknown>;
          tools.push({
            id: event.toolUse.toolUseId,
            name,
            args,
            status: "running",
            startedAt: Date.now(),
          });
          // The orchestrator routes via a single "route" tool; surface the chosen specialist.
          const specialist = name === "route" ? String(args.specialist ?? "") : name;
          if (AGENT_NAMES.has(specialist)) {
            setContext((c) => ({ ...c, active: specialist }));
            setSpecialist({ name: specialist, tool: null, text: "", visible: true });
          }
          updateTools(id, tools);
          setPhase({ kind: "tool", tool: AGENT_NAMES.has(specialist) ? specialist : name });
        } else if (event.type === "modelStreamUpdateEvent") {
          const e = event.event;
          if (e.type === "modelContentBlockDeltaEvent" && e.delta.type === "textDelta") {
            live += e.delta.text;
            // Fresh thinking (after the last tool result) takes over the banner.
            if (lastThink(live.slice(thinkMark)) !== null) {
              setPhase((p) => (p.kind === "thinking" ? p : { kind: "thinking" }));
            }
            render();
            // Once the orchestrator starts writing, the specialist's result is done.
            setSpecialist((s) => (s.visible && s.text.trim().length > 0 ? { ...s, visible: false } : s));
          } else if (e.type === "modelMessageStartEvent") {
            // Context grows per model call (phase); reflect it as it happens.
            setContext((c) => ({ ...c, used: model.lastContextUsed }));
          }
        } else if (event.type === "toolResultEvent") {
          const r = event.result;
          const call = tools.find((t) => t.id === r.toolUseId);
          if (call) {
            call.status = r.status === "error" ? "error" : "success";
            call.result = toolResultText(r.content);
            call.duration = Date.now() - call.startedAt;
          }
          const subName = call
            ? call.name === "route"
              ? String((call.args as Record<string, unknown>).specialist ?? "")
              : call.name
            : "";
          if (call && AGENT_NAMES.has(subName)) {
            const sub = agentModels.get(subName);
            setContext((c) => ({ ...c, active: null, activeUsed: sub?.lastContextUsed ?? 0 }));
          }
          const md = toolResultText(r.content);
          if (md.trim().length > 0) segments.push(md);
          thinkMark = live.length;
          updateTools(id, tools);
          render();
        }
        step = await iterator.next();
      }
      const result = step.value as {
        stopReason: string;
        interrupts?: { id: string; reason?: unknown }[];
      };
      pendingInterruptsRef.current = null;
      setContext((c) => ({ ...c, used: model.lastContextUsed }));
      if (result.stopReason === "interrupt" && result.interrupts && result.interrupts.length > 0) {
        pendingInterruptsRef.current = result.interrupts.map((intr) => ({ id: intr.id, reason: intr.reason }));
        for (const intr of result.interrupts) {
          segments.push(
            `_queen needs input:_ ${typeof intr.reason === "string" ? intr.reason : "queen is waiting for you."}`,
          );
        }
        updateTools(id, tools);
        render();
        ok = false; // mid-agent pause: not a final answer
        return;
      }
      if (model.lastTruncated) {
        push("system", `…response stopped at the ${model.lastMaxTokens}-token limit — ask me to continue.`);
      }
      if (result.stopReason === "cancelled" || model.lastStopReason === "cancelled") {
        ok = false;
        updateMsg(id, `${stripToolMarkup([...segments, live].join("\n\n"))} …cancelled`);
        return;
      }
      if (stripToolMarkup([...segments, live].join("\n\n")).trim().length === 0 && tools.length === 0) {
        updateMsg(id, "(no response)");
      }
    } catch (e) {
      ok = false;
      if (e instanceof EngineCancelled) {
        updateMsg(id, `${stripToolMarkup([...segments, live].join("\n\n"))} …cancelled`);
      } else {
        updateMsg(id, `error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      // Final answer only: the orchestrator's output after the last tool (its
      // whole output when there was no tool), never the specialist/tool text.
      if (ok) {
        const answer = toAnswer(live.slice(thinkMark)) || toAnswer(live);
        if (answer) {
          setFinalAnswer(answer);
          setAnswerView(null);
          setAnswerSeq((n) => n + 1);
        }
      }
      setStreamingId((cur) => (cur === id ? null : cur));
    }
  };

  const withFallback = async (
    attempted: string,
    detail: string,
    fn: () => Promise<string | CommandResult>,
  ) => {
    try {
      setPhase({ kind: "working", label: "Querying bee cli", detail: attempted });
      const out = await fn();
      if (typeof out === "string") push("queen", out);
      else push("queen", out.text, out.view ?? null);
    } catch (e) {
      if (isNotLoggedIn(e)) {
        if (!modelAvailable()) {
          // queen-lite: no local model to soften the message, so use the static notice.
          push("queen", OFFLINE_NOTICE);
          return;
        }
        const id = pushStreaming();
        setPhase({ kind: "thinking" });
        try {
          const res = await streamFallback({
            attempted,
            detail,
            onChunk: (t) => updateMsg(id, `[offline queen]\n\n${t}`),
            isCancelled: () => cancelRef.current,
          });
          if (res.truncated) {
            push("system", `…response stopped at the ${res.maxTokens}-token limit — ask me to continue.`);
          }
        } catch (e2) {
          if (e2 instanceof EngineCancelled) updateMsg(id, "…cancelled");
          else updateMsg(id, `[offline queen]\n\nerror: ${e2 instanceof Error ? e2.message : String(e2)}`);
        } finally {
          setStreamingId((cur) => (cur === id ? null : cur));
        }
      } else {
        push("error", `error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const runCommand = async (line: string) => {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "help":
      case "commands":
        ui.openModal("commands");
        return;
      case "theme":
        ui.openModal("theme");
        return;
      case "quit":
        quit();
        return;
      case "status":
        await withFallback("/status", "They asked whether their Bee account is connected.", async () =>
          renderStatusMd(await getStatus()),
        );
        return;
      case "me":
        await withFallback("/me", "They asked to see their Bee profile.", () => getMe());
        return;
      case "activity":
        await withFallback("/activity", "They asked for their recent Bee activity.", () => getActivity());
        return;
      case "now":
        await withFallback("/now", "They asked for recent conversations with utterances.", () => getNow());
        return;
      case "changed":
        await withFallback("/changed", "They asked what changed recently in Bee.", () => getChanged());
        return;
      case "conversations":
        await withFallback("/conversations", "They asked to list their conversations.", () => listConversations());
        return;
      case "daily":
        await withFallback("/daily", "They asked to list their daily summaries.", () => listDailySummaries());
        return;
      case "facts":
        await withFallback("/facts", "They asked to list their saved facts.", () => listFacts());
        return;
      case "insights":
        await withFallback("/insights", "They asked to list Bee insights.", () => getInsights());
        return;
      case "journals":
        await withFallback("/journals", "They asked to list their journals.", () => listJournals());
        return;
      case "locations": {
        const current = rest.includes("--current");
        await withFallback(
          "/locations",
          current ? "They asked for their current location." : "They asked for their location clusters.",
          () => getLocations("prod", current),
        );
        return;
      }
      case "today": {
        const context = rest.includes("--context");
        await withFallback(
          "/today",
          context ? "They asked for their full daily context." : "They asked for today's brief.",
          () => (context ? getTodayContext() : getTodayBrief()),
        );
        return;
      }
      case "search": {
        const limitMatch = /--limit\s+(\d+)/.exec(arg);
        const limit = limitMatch?.[1] ? Math.min(Math.max(parseInt(limitMatch[1], 10), 1), 100) : 5;
        const query = arg.replace(/--limit\s+\d+/, "").trim();
        if (!query) {
          push("error", "error: usage: /search <query> [--limit N]");
          return;
        }
        await withFallback("/search", `They searched Bee for '${query}'.`, () => searchBee({ query, limit }));
        return;
      }
      case "login": {
        if (rest[0] === "--token") {
          const token = rest.slice(1).join(" ");
          if (!token) {
            push("error", "error: usage: /login --token <token>");
            return;
          }
          try {
            const name = await loginWithToken({ token });
            setLoggedIn(true);
            push("queen", `Connected to Bee as ${name}.`);
          } catch (e) {
            push("error", `error: ${e instanceof Error ? e.message : String(e)}`);
          }
          return;
        }
        const withQr = rest.includes("--qr");
        try {
          const start = await startPairing({ withQr });
          push(
            "system",
            `${start.resumed ? "Resuming pairing session." : "Approve in the Bee app:"}\n${start.pairingUrl}` +
              (start.qr ? `\n${start.qr}` : "") +
              "\nWaiting for approval… (esc cancels)",
          );
          cancelRef.current = false;
          const out = await pollPairing({ isCancelled: () => cancelRef.current });
          setLoggedIn(true);
          push("queen", `Connected to Bee as ${out.name}.`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "ALREADY_PAIRED") {
            setLoggedIn(true);
            push("queen", "Already paired — you're connected.");
          } else {
            push("error", `error: ${msg}`);
          }
        }
        return;
      }
      case "logout":
        await logout();
        setLoggedIn(false);
        push("system", "Logged out.");
        return;
      default:
        push("error", `error: unknown command /${cmd ?? ""}. Try /help.`);
    }
  };

  const send = async (line: string) => {
    const text = line.trim();
    if (!text || busy || !ready) return;
    cancelRef.current = false;
    push("user", text);
    setBusy(true);
    setPhase({ kind: "idle" });
    setSpecialist({ name: null, tool: null, text: "", visible: false });
    try {
      if (text.startsWith("/")) await runCommand(text);
      else if (!modelAvailable()) {
        push("error", "error: this build has no model (queen-lite) — commands only. Try /help.");
      } else {
        const pending = pendingInterruptsRef.current ?? undefined;
        pendingInterruptsRef.current = null;
        await streamAgent(text, pending);
      }
    } finally {
      setBusy(false);
      setPhase({ kind: "done" });
    }
  };

  return {
    msgs,
    streamingId,
    busy,
    phase,
    ready,
    loggedIn,
    send,
    cancel,
    context,
    specialist,
    finalAnswer,
    answerView,
    answerSeq,
  };
}
