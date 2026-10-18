import { Agent, configureLogging, tool, type JSONSchema } from "@strands-agents/sdk";

import { TokenBudgetConversationManager } from "./conversation-manager";
import { modelParams } from "./model-params";

import { fetchConversation, resolveDocument, type QueenDocument } from "../documents";
import { ElthurModel } from "./strands-model";

configureLogging({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}); //HACK null out the loggers to prevent corrupting console hoo haa

export const DOC_SYSTEM = `You are Queen, reading one Bee document (a conversation, daily summary, fact, todo, journal or insight).
You are given its title, subtitle, date and summary. That summary is often enough to answer.
- Prefer answering from the summary.
- Call read_document when you need the full document (transcript, exact wording, specifics). With no argument it returns the entire open document, so you do NOT need to pass an id.
- If a request is ambiguous, ask one short clarifying question.
- Plain Markdown prose. Never invent transcript lines or facts. Keep answers concise.`;

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

export type ChatMeta = { promptTokens?: number; ttftMs?: number };

export type ChatCallbacks = {
  onText: (rawSoFar: string) => void;
  onTool: (event: ChatToolEvent) => void;
  onMeta?: (meta: ChatMeta) => void;
  isCancelled?: () => boolean;
};

export type DocumentChatSession = {
  key: string;
  send: (question: string, callbacks: ChatCallbacks) => Promise<void>;
};

type ResultBlock = { content?: readonly { type?: string; text?: string }[] };

function resultText(block: unknown): string {
  const content = (block as ResultBlock | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item.type === "textBlock" ? item.text ?? "" : ""))
    .filter((line) => line.length > 0)
    .join("\n");
}

function makeReadDocumentTool(doc: QueenDocument) {
  const openDocument = async (): Promise<string> => {
    // The open conversation's transcript isn't prefetched, so fetch it on demand.
    if (doc.kind === "conversation") {
      try {
        return (await fetchConversation(doc.id)).markdown;
      } catch {
        return doc.markdown;
      }
    }
    return doc.markdown;
  };

  return tool({
    name: "read_document",
    description:
      "Load the full document for a Bee item. Called with no argument, or with the open document's own id, it returns the entire open document. Pass an id only for a different, explicitly named document (e.g. `todo:123`).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Optional id of a different document. Omit to read the open document.",
        },
      },
    } as JSONSchema,
    callback: async (raw: unknown) => {
      const input = (raw ?? {}) as { id?: unknown };
      const requested = String(input.id ?? "").trim();
      const isOpen =
        requested.length === 0 ||
        requested === doc.key ||
        requested === doc.id ||
        requested === `${doc.kind}:${doc.id}`;
      if (isOpen) return openDocument();
      try {
        return (await resolveDocument(requested)).markdown;
      } catch {
        // Never error: fall back to the open document.
        return openDocument();
      }
    },
  });
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

async function streamAgent(agent: Agent, prompt: string, callbacks: ChatCallbacks): Promise<void> {
  const controller = new AbortController();
  const started = new Map<string, number>();
  let raw = "";
  let metaSent = false;
  
  const poll = setInterval(() => {
    if (callbacks.isCancelled?.()) controller.abort(); //TODO Cancellation may arrive between model deltas; poll so esc stays responsive.
  }, 150);

  try {
    for await (const event of agent.stream(prompt, { cancelSignal: controller.signal })) {
      if (callbacks.isCancelled?.()) controller.abort();
      switch (event.type) {
        case "modelStreamUpdateEvent": {
          const inner = event.event;
          if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
            raw += inner.delta.text;
            callbacks.onText(raw);
          } else if (inner.type === "modelMetadataEvent" && !metaSent) {
            // Report the first generation of the turn — that is the user-turn prefill.
            metaSent = true;
            const trace = inner.trace as { promptTokens?: number; ttftMs?: number } | undefined;
            if (trace) callbacks.onMeta?.({ promptTokens: trace.promptTokens, ttftMs: trace.ttftMs });
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

export function createDocumentChat(doc: QueenDocument): DocumentChatSession {
  const model = new ElthurModel({ systemPrompt: DOC_SYSTEM, maxTokens: 1024 });
  const agent = new Agent({
    model,
    systemPrompt: DOC_SYSTEM,
    tools: [makeReadDocumentTool(doc)],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: new TokenBudgetConversationManager({
      // Only trim near the 32k window: a fixed small window would invalidate the
      // engine's prefix cache every turn. pinFirst keeps the document context.
      budget: Math.floor(modelParams().contextWindow * 0.8),
      pinFirst: 1,
    }),
  });

  let started = false;
  return {
    key: doc.key,
    send: async (question, callbacks) => {
      const prompt = started ? question : firstTurnPrompt(doc, question);
      await streamAgent(agent, prompt, callbacks);
      started = true;
    },
  };
}
