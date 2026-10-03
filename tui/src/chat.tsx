import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { useTheme } from "./theme/use-theme";

import {loginWithToken, logout, pollPairing, renderStatusMd, searchBee, startPairing} from "./utils/bee";
import { getMe, getStatus, getTodayBrief, getTodayContext, isNotLoggedIn} from "./utils/bee";
import { EngineCancelled, streamFallback } from "./utils/queen-ffi";
import { createQueenAgent, ElthurModel } from "./utils/strands-model";
import { Spinner } from "./components/spinner";
import { stripToolMarkup } from "./utils/tool-definitions";
import { useUi } from "./userinterface";

type Role = "user" | "queen" | "error" | "system";
export type ChatMessage = { id: number; role: Role; text: string };

// Reasoning emitted between the think tags is shown dim + muted; the rest
// renders as markdown. An unclosed tag (still streaming) stays "thinking".
// The tag characters are hex-escaped so they survive any editor/transport.
const THINK = /\x3cthink\x3e([\s\S]*?)(?:\x3c\/think\x3e|$)/g;

function QueenBody({ text, streaming, style }: { text: string; streaming: boolean; style: SyntaxStyle }) {
  const theme = useTheme();
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  THINK.lastIndex = 0;
  while ((m = THINK.exec(text))) {
    const before = text.slice(last, m.index);
    if (before.trim()) {
      nodes.push(<markdown key={key++} content={before} syntaxStyle={style} streaming={streaming} />);
    }
    const think = (m[1] ?? "").trim();
    if (think) {
      nodes.push(
        <text key={key++} fg={theme.colors.mutedForeground} attributes={TextAttributes.DIM}>
          {think}
        </text>,
      );
    }
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) {
    nodes.push(<markdown key={key++} content={tail} syntaxStyle={style} streaming={streaming} />);
  }
  return <>{nodes}</>;
}

export type ChatController = {
  msgs: ChatMessage[];
  streamingId: number | null;
  busy: boolean;
  send: (line: string) => Promise<void>;
};

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
  const idRef = useRef(1);
  const cancelRef = useRef(false);

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

  const quit = () => {
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") quit();
    if (ui.modalOpen) return; // a modal owns esc and friends while it is open
    if (key.name === "escape") {
      cancelRef.current = true;
      agentRef.current?.cancel();
    }
  });

  const streamAgent = async (text: string) => {
    const agent = agentRef.current;
    const model = modelRef.current;
    if (!agent || !model) return;
    const id = pushStreaming();
    const segments: string[] = [];
    let live = "";
    let status = "";
    const render = () => updateMsg(id, [...segments, status, live].filter((s) => s.trim().length > 0).join("\n\n"));
    try {
      // MARK: - One turn agentic loop let's goo
      for await (const event of agent.stream(text)) {
        if (event.type === "modelStreamUpdateEvent") {
          const e = event.event;
          if (e.type === "modelContentBlockDeltaEvent" && e.delta.type === "textDelta") {
            status = "";
            live += e.delta.text;
            render();
          } else if (e.type === "modelContentBlockStartEvent" && e.start?.type === "toolUseStart") {
            if (live.trim().length > 0) segments.push(live);
            live = "";
            status = e.start.name === "get_weather" ? "Checking the weather…" : `Running ${e.start.name}…`;
            render();
          }
        } else if (event.type === "toolResultEvent") {
          const md = event.result.content
            .map((item) =>
              item.type === "textBlock"
                ? item.text
                : item.type === "jsonBlock"
                  ? JSON.stringify(item.json, null, 2)
                  : "",
            )
            .filter((s) => s.length > 0)
            .join("\n");
          status = "";
          if (md.trim().length > 0) segments.push(md);
          render();
        }
      }
      if (model.lastTruncated) {
        push("system", `…response stopped at the ${model.lastMaxTokens}-token limit — ask me to continue.`);
      }
      if (model.lastStopReason === "cancelled") {
        updateMsg(id, `${stripToolMarkup([...segments, live].join("\n\n"))} …cancelled`);
        return;
      }
      if (stripToolMarkup([...segments, live].join("\n\n")).trim().length === 0 && status.length === 0) {
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
          const res = await streamFallback(
            attempted,
            detail,
            (t) => updateMsg(id, `[offline queen]\n\n${t}`),
            () => cancelRef.current,
          );
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
        await withFallback("/search", `They searched Bee for '${query}'.`, () => searchBee(query, limit));
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
            const name = await loginWithToken(token);
            push("queen", `Connected to Bee as ${name}.`);
          } catch (e) {
            push("error", `error: ${e instanceof Error ? e.message : String(e)}`);
          }
          return;
        }
        const withQr = rest.includes("--qr");
        try {
          const start = await startPairing("prod", withQr);
          push(
            "system",
            `${start.resumed ? "Resuming pairing session." : "Approve in the Bee app:"}\n${start.pairingUrl}` +
              (start.qr ? `\n${start.qr}` : "") +
              "\nWaiting for approval… (esc cancels)",
          );
          cancelRef.current = false;
          const out = await pollPairing("prod", () => cancelRef.current);
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
        await streamAgent(text);
      }
    } finally {
      setBusy(false);
    }
  };

  return { msgs, streamingId, busy, send };
}

// MARK: - Presentation: the message log only. The input lives in the dashboard.
export function Chat({
  msgs,
  streamingId,
  busy,
}: {
  msgs: ChatMessage[];
  streamingId: number | null;
  busy: boolean;
}) {
  const style = useMemo(() => SyntaxStyle.create(), []);
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        {msgs.map((m) =>
          m.role === "queen" ? (
            <box key={m.id} flexDirection="column">
              <QueenBody text={m.text} streaming={m.id === streamingId} style={style} />
            </box>
          ) : m.role === "user" ? (
            <text key={m.id}>
              <b>❯ </b>
              {m.text}
            </text>
          ) : m.role === "error" ? (
            <text key={m.id} attributes={TextAttributes.BOLD}>
              {m.text}
            </text>
          ) : (
            <text key={m.id} attributes={TextAttributes.DIM}>
              {m.text}
            </text>
          ),
        )}
        {busy && <Spinner label="thinking" />}
      </scrollbox>
    </box>
  );
}
