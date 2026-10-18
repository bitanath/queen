import { Agent, configureLogging } from "@strands-agents/sdk";

import { ElthurModel } from "./strands-model";
import { createQueenAgent } from "./tools-execution";
import { routeHint } from "./agents/orchestrator";
import { ensureBeeMcp } from "../libraries/bee-mcp";
import type { QueenDocument } from "../documents";
import type { UiBridge } from "./ui-bridge";

configureLogging({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}); //HACK null out the loggers to prevent corrupting the console render

export type ChatToolStatus = "running" | "success" | "error";

export type ChatToolInfo = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: ChatToolStatus;
  result?: string;
  error?: string;
  durationMs?: number;
};

export type ChatToolEvent = { kind: "start" | "end"; info: ChatToolInfo };

export type ChatMeta = {
  promptTokens?: number;
  prefillTokens?: number;
  generatedTokens?: number;
  ttftMs?: number;
  tokPerSec?: number;
  totalMs?: number;
};

export type ChatCallbacks = {
  onText: (rawSoFar: string) => void;
  onTool: (event: ChatToolEvent) => void;
  onMeta?: (meta: ChatMeta) => void;
  isCancelled?: () => boolean;
};

export type ChatSession = {
  key: string;
  send: (question: string, callbacks: ChatCallbacks) => Promise<void>;
};

type ResultBlock = { content?: readonly { type?: string; text?: string; json?: unknown }[] };

function resultText(block: unknown): string {
  const content = (block as ResultBlock | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      item.type === "textBlock" ? item.text ?? "" : item.type === "jsonBlock" ? JSON.stringify(item.json) : "",
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

function firstTurnPrompt(doc: QueenDocument, question: string): string {
  const date = doc.meta.find((item) => item.key === "when")?.value ?? "";
  return [
    `Title: ${doc.title}`,
    `Subtitle: ${doc.subtitle}`,
    `Date: ${date}`,
    `Document: ${doc.key}`,
    "",
    doc.summary,
    "",
    `Current time: ${new Date().toISOString()}`,
    "",
    "QUESTION",
    question,
  ].join("\n");
}

async function streamAgent(
  agent: Agent,
  getPrompt: (question: string) => string,
  question: string,
  callbacks: ChatCallbacks,
): Promise<void> {
  const controller = new AbortController();
  const started = new Map<string, number>();
  let raw = "";
  let metaSent = false;

  const poll = setInterval(() => {
    if (callbacks.isCancelled?.()) controller.abort();
  }, 150);

  try {
    for await (const event of agent.stream(getPrompt(question), { cancelSignal: controller.signal })) {
      if (callbacks.isCancelled?.()) controller.abort();
      switch (event.type) {
        case "modelStreamUpdateEvent": {
          const inner = event.event;
          if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
            raw += inner.delta.text;
            callbacks.onText(raw);
          } else if (inner.type === "modelMetadataEvent" && !metaSent) {
            metaSent = true;
            const trace = inner.trace as ChatMeta | undefined;
            if (trace) callbacks.onMeta?.(trace);
          }
          break;
        }
        case "beforeToolCallEvent": {
          const id = event.toolUse.toolUseId;
          started.set(id, Date.now());
          callbacks.onTool({
            kind: "start",
            info: {
              id,
              name: event.toolUse.name,
              args: (event.toolUse.input ?? {}) as Record<string, unknown>,
              status: "running",
            },
          });
          break;
        }
        case "afterToolCallEvent": {
          const id = event.toolUse.toolUseId;
          const began = started.get(id);
          callbacks.onTool({
            kind: "end",
            info: {
              id,
              name: event.toolUse.name,
              args: (event.toolUse.input ?? {}) as Record<string, unknown>,
              status: event.error ? "error" : "success",
              result: resultText(event.result),
              ...(event.error ? { error: event.error.message } : {}),
              ...(began !== undefined ? { durationMs: Date.now() - began } : {}),
            },
          });
          break;
        }
        default:
          break;
      }
    }
  } finally {
    clearInterval(poll);
  }
}

export async function createChatSession(doc: QueenDocument, bridge: UiBridge): Promise<ChatSession> {
  await ensureBeeMcp();
  const model = new ElthurModel({ systemPrompt: undefined, maxTokens: 1024 });
  const agent = createQueenAgent(model, bridge);

  let started = false;
  return {
    key: doc.key,
    send: async (question, callbacks) => {
      // Deterministic routing hint for the live question (system prefix stays cached).
      const hint = routeHint(question, doc.kind);
      const base = started ? question : firstTurnPrompt(doc, question);
      const prompt = hint ? `${hint}\n\n${base}` : base;
      await streamAgent(agent, () => prompt, question, callbacks);
      started = true;
    },
  };
}
