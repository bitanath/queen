// Strands Agents integration for the elthur engine. ElthurModel is a Strands
// `Model` provider that drives the embedded dylib: it serializes the agent's
// message history into elthur's ChatMessageC format, sends the OpenAI-style
// tools JSON the engine understands, and maps the engine's streamed text plus
// parsed tool calls back into Strands `ModelStreamEvent`s. Strands owns the
// conversation history (memory) and the tool loop; the library is untouched.
import {
  Agent,
  Model,
  SlidingWindowConversationManager,
  type BaseModelConfig,
  type JSONSchema,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
  type SystemPrompt,
  type StopReason,
  type ToolSpec,
} from "@strands-agents/sdk";
import {
  CHAT_SYSTEM,
  beginStream,
  freeStream,
  pollStream,
  streamTruncated,
  toolCallsOf,
  type EngineMessage,
} from "./queen-ffi";
import { stripToolMarkup, weatherTool } from "./tools";

// elthur loads the model with a fixed context_size of 4096 (see index.zig).
const CONTEXT_WINDOW = 4096;
const DEFAULT_MAX_TOKENS = 1024;

// Markers the engine's tool parser may emit, mirrored from tools.ts.
const OPEN_TAGS = ["<tool_call>", "<|tool_call_start|>"];

export type ElthurModelConfig = BaseModelConfig & {
  /** Fixed system prompt. elthur bakes this into the model on first load. */
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

// Flatten Strands messages into elthur turns. The engine has no native tool
// role, so tool-use is rendered as the <tool_call> markup its encoders teach,
// and tool results as plain text in the following (user) turn.
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
          break; // reasoning/cache/guard/media are not sent to the local engine
      }
    }
    const content = parts.join("\n").trim();
    if (content.length > 0) out.push({ role: message.role, content });
  }
  return out;
}

// Hold back a trailing string that could still grow into a tool-call marker, so
// incremental stripping never emits partial markup. stripToolMarkup drops an
// unterminated span, so once held back, output only ever grows.
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

  /** Whether the most recent generation hit the output-token budget. */
  lastTruncated = false;
  /** The budget of the most recent generation. */
  lastMaxTokens = DEFAULT_MAX_TOKENS;
  /** The stop reason of the most recent model call. */
  lastStopReason: StopReason = "endTurn";

  constructor(config: ElthurModelConfig = {}) {
    super();
    this.config = {
      modelId: "elthur-local",
      contextWindowLimit: CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.3,
      topP: 0.9,
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
    const system = systemText(options?.systemPrompt) ?? this.config.systemPrompt ?? CHAT_SYSTEM;
    const specs = options?.toolSpecs ?? [];
    const toolsJson = specs.length > 0 ? toOpenAITools(specs) : null;
    const engineMessages = toEngineMessages(messages);
    if (engineMessages.length === 0) engineMessages.push({ role: "user", content: "" });
    const maxTokens = this.config.maxTokens ?? DEFAULT_MAX_TOKENS;

    const handle = beginStream(engineMessages, system, toolsJson, maxTokens);
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
        if (n === -2) throw new Error("elthur engine failed");
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
        trace: { truncated, maxTokens },
      };
    } finally {
      freeStream(handle);
    }
  }
}

/// Build the queen chat agent: local elthur model, the weather tool, and a
/// bounded sliding-window history so the 4k engine context never overflows.
export function createQueenAgent(
  model: ElthurModel = new ElthurModel({ systemPrompt: CHAT_SYSTEM }),
): Agent {
  return new Agent({
    model,
    tools: [weatherTool],
    systemPrompt: CHAT_SYSTEM,
    // Never print to the TUI's stdout.
    printer: false,
    // Engine failures should surface, not silently retry in a loop.
    retryStrategy: null,
    conversationManager: new SlidingWindowConversationManager({ windowSize: 10 }),
  });
}
