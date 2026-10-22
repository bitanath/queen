import { configureLogging } from "@strands-agents/sdk";

import type { UiBridge } from "./ui-bridge";
import { AgentRunner } from "./agents/runner";
import { createSession } from "./agents/session";
import type { AgentStatus, ToolRunEvent } from "./agents/types";

configureLogging({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

export type ChatToolStatus = "running" | "success" | "error";

export type ChatToolInfo = ToolRunEvent["info"];

export type ChatToolEvent = ToolRunEvent;

export type ChatMeta = {
  promptTokens?: number;
  prefillTokens?: number;
  generatedTokens?: number;
  ttftMs?: number;
  tokPerSec?: number;
  totalMs?: number;
};

export type ChatCallbacks = {
  onAck?: (text: string) => void;
  onText: (rawSoFar: string) => void;
  onThinking?: (text: string) => void;
  onTool: (event: ChatToolEvent) => void;
  onStatus?: (status: AgentStatus) => void;
  onMeta?: (meta: ChatMeta) => void;
  isCancelled?: () => boolean;
};

export type ChatSession = {
  send: (question: string, callbacks: ChatCallbacks) => Promise<void>;
};

export async function createChatSession(bridge: UiBridge): Promise<ChatSession> {
  const session = createSession();
  const runner = new AgentRunner({ bridge, mode: "tui", session });

  return {
    send: async (question, callbacks) => {
      await runner.run(question, {
        onAck: callbacks.onAck,
        onText: callbacks.onText,
        onThinking: callbacks.onThinking,
        onTool: callbacks.onTool,
        ...(callbacks.onStatus ? { onStatus: callbacks.onStatus } : {}),
        ...(callbacks.isCancelled ? { isCancelled: callbacks.isCancelled } : {}),
      });
    },
  };
}
