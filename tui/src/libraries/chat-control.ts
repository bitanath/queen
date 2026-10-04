// Chat controller for the dashboard: owns the Strands agent, conversation,
// streaming, tool-call tracking and slash-command handling. The presentational
// `Chat` view lives in ../chat.tsx; this module is JSX-free so it can sit in
// libraries/.

import { useKeyboard, useRenderer } from "@opentui/react";
import { useRef, useState } from "react";

import {
  getMe,
  getStatus,
  getTodayBrief,
  getTodayContext,
  isNotLoggedIn,
  loginWithToken,
  logout,
  pollPairing,
  renderStatusMd,
  searchBee,
  startPairing,
} from "../utils/bee-com-bridge";
import { EngineCancelled, streamFallback } from "../utils/queen-ffi";
import { ElthurModel } from "../functions/strands-model";
import { agentModels, createQueenAgent } from "../functions/tools-execution";
import { AGENT_SPECS } from "../functions/agents";
import { stripToolMarkup } from "../functions/tool-definitions";
import { useUi } from "../userinterface";
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

export type ChatController = {
  msgs: ChatMessage[];
  streamingId: number | null;
  busy: boolean;
  send: (line: string) => Promise<void>;
  cancel: () => void;
  context: { used: number; active: string | null; activeUsed: number };
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

// MARK: - Chat engine. Owns the Strands agent, conversation, streaming and command
// handling. Kept separate from the view so the input can live elsewhere (the
// full-width text area below the dashboard columns).
export function useChat(): ChatController {
  const renderer = useRenderer();
  const ui = useUi();
  const [msgs, setMsgs] = useState<ChatMessage[]>([
    { id: 0, role: "system", text: "Welcome to queen. Type /help for commands, /login to connect Bee." },
  ]);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [context, setContext] = useState<{ used: number; active: string | null; activeUsed: number }>({
    used: 0,
    active: null,
    activeUsed: 0,
  });
  const idRef = useRef(1);
  const cancelRef = useRef(false);
  const pendingInterruptsRef = useRef<{ id: string; reason?: unknown }[] | null>(null);

  // MARK: - One Strands agent per chat pane: owns conversation memory and tool loop. Model instance is kept alongside so we can read truncation state.
  const modelRef = useRef<ElthurModel | null>(null);
  const agentRef = useRef<ReturnType<typeof createQueenAgent> | null>(null);
  if (agentRef.current === null) {
    const model = new ElthurModel();
    modelRef.current = model;
    agentRef.current = createQueenAgent(model);
  }

  const push = (role: Role, text: string) => {
    const id = idRef.current++;
    setMsgs((m) => [...m, { id, role, text }]);
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
          tools.push({
            id: event.toolUse.toolUseId,
            name,
            args: (event.toolUse.input ?? {}) as Record<string, unknown>,
            status: "running",
            startedAt: Date.now(),
          });
          if (AGENT_NAMES.has(name)) setContext((c) => ({ ...c, active: name }));
          updateTools(id, tools);
        } else if (event.type === "modelStreamUpdateEvent") {
          const e = event.event;
          if (e.type === "modelContentBlockDeltaEvent" && e.delta.type === "textDelta") {
            live += e.delta.text;
            render();
          }
        } else if (event.type === "toolResultEvent") {
          const r = event.result;
          const call = tools.find((t) => t.id === r.toolUseId);
          if (call) {
            call.status = r.status === "error" ? "error" : "success";
            call.result = toolResultText(r.content);
            call.duration = Date.now() - call.startedAt;
          }
          if (call && AGENT_NAMES.has(call.name)) {
            const sub = agentModels.get(call.name);
            setContext((c) => ({ ...c, active: null, activeUsed: sub?.lastContextUsed ?? 0 }));
          }
          const md = toolResultText(r.content);
          if (md.trim().length > 0) segments.push(md);
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
        return;
      }
      if (model.lastTruncated) {
        push("system", `…response stopped at the ${model.lastMaxTokens}-token limit — ask me to continue.`);
      }
      if (result.stopReason === "cancelled" || model.lastStopReason === "cancelled") {
        updateMsg(id, `${stripToolMarkup([...segments, live].join("\n\n"))} …cancelled`);
        return;
      }
      if (stripToolMarkup([...segments, live].join("\n\n")).trim().length === 0 && tools.length === 0) {
        updateMsg(id, "(no response)");
      }
    } catch (e) {
      if (e instanceof EngineCancelled) {
        updateMsg(id, `${stripToolMarkup([...segments, live].join("\n\n"))} …cancelled`);
      } else {
        updateMsg(id, `error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setStreamingId((cur) => (cur === id ? null : cur));
    }
  };

  const withFallback = async (attempted: string, detail: string, fn: () => Promise<string>) => {
    try {
      push("queen", await fn());
    } catch (e) {
      if (isNotLoggedIn(e)) {
        const id = pushStreaming();
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
        ui.openModal("help");
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
          push("queen", `Connected to Bee as ${out.name}.`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "ALREADY_PAIRED") {
            push("queen", "Already paired — you're connected.");
          } else {
            push("error", `error: ${msg}`);
          }
        }
        return;
      }
      case "logout":
        await logout();
        push("system", "Logged out.");
        return;
      default:
        push("error", `error: unknown command /${cmd ?? ""}. Try /help.`);
    }
  };

  const send = async (line: string) => {
    const text = line.trim();
    if (!text || busy) return;
    cancelRef.current = false;
    push("user", text);
    setBusy(true);
    try {
      if (text.startsWith("/")) await runCommand(text);
      else {
        const pending = pendingInterruptsRef.current ?? undefined;
        pendingInterruptsRef.current = null;
        await streamAgent(text, pending);
      }
    } finally {
      setBusy(false);
    }
  };

  return { msgs, streamingId, busy, send, cancel, context };
}
