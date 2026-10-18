import {type BaseModelConfig, type JSONSchema, type Message, type ModelStreamEvent, type StreamOptions, type SystemPrompt, type StopReason, type ToolSpec} from "@strands-agents/sdk"
import { beginStream, freeStream, pollStream, promptTokensOf, streamTruncated, toolCallsOf, ttftMsOf, type EngineMessage, } from "../utils/queen-ffi";
import { Model } from "@strands-agents/sdk";
import { CHAT_SYSTEM_HIGH, modelParams } from "./model-params";
import { stripToolMarkup } from "./tool-definitions";


const CONTEXT_WINDOW = 32768;
const DEFAULT_MAX_TOKENS = 1024;

const OPEN_TAGS = ["<tool_call>", "<|tool_call_start|>"];

export type ElthurModelConfig = BaseModelConfig & {
  systemPrompt?: string;
};

function systemText(prompt: SystemPrompt | undefined): string | undefined {
  if (prompt === undefined) return undefined;
  if (typeof prompt === "string") return prompt;
  return prompt
    .map((block) => (block.type === "textBlock" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

// Strands ToolSpec -> the OpenAI "tools" array elthur's appendToolsJson parses.
function toOpenAITools(specs: ToolSpec[]): string {
  return JSON.stringify(
    specs.map((spec) => ({
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema ?? { type: "object", properties: {} },
      },
    })),
  );
}

function parameterXml(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `<parameter=${key}>\n${text}\n</parameter>`;
    })
    .join("\n");
}

function renderToolUse(block: { name: string; input: unknown }): string {
  return `<tool_call>\n<function=${block.name}>\n${parameterXml(block.input)}\n</function>\n</tool_call>`;
}

function renderToolResult(block: {
  content: readonly { type: string; text?: string; json?: unknown }[];
}): string {
  return block.content
    .map((item) => {
      if (item.type === "textBlock") return item.text ?? "";
      if (item.type === "jsonBlock") return JSON.stringify(item.json);
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

//NOTE Flatten Strands messages, no native tool role, so tool-use rendered as <tool_call> markup and results as plain text in the following (user) turn.
function toEngineMessages(messages: Message[]): EngineMessage[] {
  const out: EngineMessage[] = [];
  for (const message of messages) {
    const parts: string[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case "textBlock":
          parts.push(block.text);
          break;
        case "toolUseBlock":
          parts.push(renderToolUse(block));
          break;
        case "toolResultBlock":
          parts.push(renderToolResult(block));
          break;
        default:
          break; //TODO reasoning/cache/guard/media are not sent to the local engine
      }
    }
    const content = parts.join("\n").trim();
    if (content.length > 0) out.push({ role: message.role, content });
  }
  return out;
}

// FIXME Hold back a trailing string that could still grow into a tool-call marker
function holdBackPartialMarker(text: string): string {
  let cut = text.length;
  for (const open of OPEN_TAGS) {
    const max = Math.min(open.length - 1, text.length);
    for (let k = max; k >= 1; k--) {
      if (text.endsWith(open.slice(0, k))) {
        cut = Math.min(cut, text.length - k);
        break;
      }
    }
  }
  return text.slice(0, cut);
}

export class ElthurModel extends Model<ElthurModelConfig> {
  private config: ElthurModelConfig;

  lastTruncated = false;
  lastMaxTokens = DEFAULT_MAX_TOKENS;
  lastStopReason: StopReason = "endTurn";
  lastContextUsed = 0;
  lastContextLimit = CONTEXT_WINDOW;
  lastPromptTokens = 0;
  lastTtftMs = 0;

  constructor(config: ElthurModelConfig = {}) {
    super();
    this.config = {
      modelId: "elthur-local",
      contextWindowLimit: modelParams().contextWindow,
      maxTokens: DEFAULT_MAX_TOKENS,
      ...config,
    };
  }

  override updateConfig(modelConfig: ElthurModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): ElthurModelConfig {
    return this.config;
  }

  override async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const system = systemText(options?.systemPrompt) ?? this.config.systemPrompt ?? modelParams().systemPrompt ?? CHAT_SYSTEM_HIGH;
    const specs = options?.toolSpecs ?? [];
    const toolsJson = specs.length > 0 ? toOpenAITools(specs) : null;
    const engineMessages = toEngineMessages(messages);
    if (engineMessages.length === 0) engineMessages.push({ role: "user", content: "" });
    const maxTokens = this.config.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Rough context accounting for the dashboard (no tokenizer available locally).
    const approxChars =
      engineMessages.reduce((n, m) => n + m.content.length, 0) +
      system.length +
      (toolsJson?.length ?? 0);
    this.lastContextUsed = Math.ceil(approxChars / 4);
    this.lastContextLimit = this.config.contextWindowLimit ?? CONTEXT_WINDOW;

    const handle = beginStream({ messages: engineMessages, system, toolsJson, maxTokens });
    const signal = options?.cancelSignal;
    const started = Date.now();
    const out = new Uint8Array(65536);
    const decoder = new TextDecoder();
    let text = "";
    let emitted = 0;
    let cancelled = false;

    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent" };
    try {
      for (;;) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        const n = pollStream(handle, out);
        if (n === -2) throw new Error("Engine failed");
        if (n > 0) {
          text += decoder.decode(out.subarray(0, n), { stream: true });
          const safe = stripToolMarkup(holdBackPartialMarker(text));
          if (safe.length > emitted) {
            yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: safe.slice(emitted) } };
            emitted = safe.length;
          }
        } else if (n === -1) {
          break;
        } else {
          await Bun.sleep(30);
        }
      }

      text += decoder.decode();
      const finalText = stripToolMarkup(text);
      if (finalText.length > emitted) {
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: finalText.slice(emitted) } };
        emitted = finalText.length;
      }
      yield { type: "modelContentBlockStopEvent" };

      const truncated = cancelled ? false : streamTruncated(handle);
      const calls = cancelled ? [] : toolCallsOf(handle);
      this.lastTruncated = truncated;
      this.lastMaxTokens = maxTokens;
      this.lastPromptTokens = cancelled ? 0 : promptTokensOf(handle);
      this.lastTtftMs = cancelled ? 0 : ttftMsOf(handle);

      const stamp = Date.now().toString(36);
      let index = 0;
      for (const call of calls) {
        const toolUseId = `call_${stamp}_${index++}`;
        yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: call.name, toolUseId } };
        yield {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "toolUseInputDelta", input: JSON.stringify(call.arguments ?? {}) },
        };
        yield { type: "modelContentBlockStopEvent" };
      }

      const stopReason: StopReason = cancelled ? "cancelled" : calls.length > 0 ? "toolUse" : "endTurn";
      this.lastStopReason = stopReason;
      yield { type: "modelMessageStopEvent", stopReason };
      yield {
        type: "modelMetadataEvent",
        metrics: { latencyMs: Date.now() - started },
        trace: {
          truncated,
          maxTokens,
          contextUsed: this.lastContextUsed,
          contextLimit: this.lastContextLimit,
          promptTokens: this.lastPromptTokens,
          ttftMs: this.lastTtftMs,
        },
      };
    } finally {
      freeStream(handle);
    }
  }
}
