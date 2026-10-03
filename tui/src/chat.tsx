import { SyntaxStyle, TextAttributes, type InputRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useMemo, useRef, useState } from "react";

import {loginWithToken, logout, pollPairing, renderStatusMd, searchBee, startPairing} from "./utils/bee";
import { getMe, getStatus, getTodayBrief, getTodayContext, isNotLoggedIn} from "./utils/bee";
import { EngineCancelled, CHAT_SYSTEM, streamFallback } from "./utils/queen-ffi";
import { createQueenAgent, ElthurModel } from "./utils/strands-model";
import { Spinner } from "./components/spinner";
import { stripToolMarkup } from "./utils/tool-definitions";
import { useUi } from "./userinterface";

type Role = "user" | "queen" | "error" | "system";
type Msg = { id: number; role: Role; text: string };

export function Chat() {
  const renderer = useRenderer();
  const ui = useUi();
  const style = useMemo(() => SyntaxStyle.create(), []);
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 0, role: "system", text: "Welcome to queen. Type /help for commands, /login to connect Bee." },
  ]);
  const [value, setValue] = useState("");
  // NOTE The <input> `value` prop is initial-only; the live buffer is cleared imperatively via the renderable (remount-by-key does NOT reset it).
  const inputRef = useRef<InputRenderable | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const idRef = useRef(1);
  const cancelRef = useRef(false);

  // MARK: - One Strands agent per chat pane: owns conversation memory and tool loop. Model instance is kept alongside so we can read truncation state.
  const modelRef = useRef<ElthurModel | null>(null);
  const agentRef = useRef<ReturnType<typeof createQueenAgent> | null>(null);
  if (agentRef.current === null) {
    const model = new ElthurModel({ systemPrompt: CHAT_SYSTEM });
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
      setValue("");
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
    setValue("");
    if (inputRef.current) inputRef.current.value = "";
    cancelRef.current = false;
    push("user", text);
    setBusy(true);
    const t0 = Date.now();
    try {
      if (text.startsWith("/")) await runCommand(text);
      else {
        await streamAgent(text);
      }
    } finally {
      setLastMs(Date.now() - t0);
      setBusy(false);
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        {msgs.map((m) =>
          m.role === "queen" ? (
            <box key={m.id} flexDirection="column">
              <text attributes={TextAttributes.DIM}>queen</text>
              <markdown content={m.text} syntaxStyle={style} streaming={m.id === streamingId} />
            </box>
          ) : m.role === "user" ? (
            <box key={m.id}>
              <text attributes={TextAttributes.BOLD}>❯ </text>
              <text>{m.text}</text>
            </box>
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
      <box>
        <text attributes={TextAttributes.BOLD}>❯ </text>
        <input
          ref={inputRef}
          focused={!busy && !ui.modalOpen}
          value={value}
          onInput={setValue}
          onSubmit={(v) => {
            if (typeof v === "string") void send(v);
          }}
          placeholder={busy ? "working…" : "message or /command"}
        />
      </box>
      <text attributes={TextAttributes.DIM}>
        {`enter send · esc clear · /help · ctrl+opt+t theme · ctrl+opt+h help · ctrl+c quit${lastMs !== null ? ` · last ${(lastMs / 1000).toFixed(1)}s` : ""}`}
      </text>
    </box>
  );
}
