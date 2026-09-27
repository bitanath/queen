import { CString, dlopen, ptr, type Pointer } from "bun:ffi";
import libPath from "../libelthur.dylib" with { type: "file" };
import type { ToolCall } from "./tools";

// elthur engine bridge. Bun embeds the thin code-only dylib in the compiled
// executable; the GGUF is appended to this executable and mapped at runtime by
// elthur's core/hosts.zig through the ELTHBLOB trailer. One model is loaded
// per process and reused for every turn via stream_start_model.

const { symbols } = dlopen(libPath, {
  // void* model_create_ex(const char* system, int32_t max_tokens,
  //     double temperature, double top_p, int32_t top_k)
  model_create_ex: { args: ["cstring", "i32", "f64", "f64", "i32"], returns: "ptr" },
  // char* model_generate(void* handle, const char* prompt) -> free_string()
  model_generate: { args: ["ptr", "cstring"], returns: "ptr" },
  model_free: { args: ["ptr"], returns: "void" },
  // void* stream_start_model(void* model, ChatMessageC* msgs, size_t n,
  //     const char* system, int32_t max_tokens, double temperature,
  //     double top_p, int32_t top_k)
  stream_start_model: {
    args: ["ptr", "ptr", "usize", "cstring", "i32", "f64", "f64", "i32"],
    returns: "ptr",
  },
  // Same as stream_start_model, plus an OpenAI-style tools JSON array. Parsed
  // tool calls are read back with stream_tool_calls once the stream is done.
  stream_start_model_ex: {
    args: ["ptr", "ptr", "usize", "cstring", "cstring", "i32", "f64", "f64", "i32"],
    returns: "ptr",
  },
  // char* stream_tool_calls(void* handle) -> [{"name":..,"arguments":{..}}]
  //   or NULL; free with free_string().
  stream_tool_calls: { args: ["ptr"], returns: "ptr" },
  // isize stream_poll(void* handle, char* out, size_t cap)
  //     bytes written, 0 idle, -1 done, -2 error
  stream_poll: { args: ["ptr", "ptr", "usize"], returns: "i64" },
  stream_free: { args: ["ptr"], returns: "void" },
  // bool stream_hit_length_limit(void* handle) — true when generation stopped
  // because the output-token budget (or context window) ran out, not on EOS.
  stream_hit_length_limit: { args: ["ptr"], returns: "bool" },
  free_string: { args: ["ptr"], returns: "void" },
});

export class EngineFailed extends Error {
  constructor() {
    super("elthur engine returned NULL");
    this.name = "EngineFailed";
  }
}

export class EngineCancelled extends Error {
  constructor() {
    super("elthur generation cancelled");
    this.name = "EngineCancelled";
  }
}

/// A finished generation plus whether it was cut off by the token budget.
export type StreamResult = { text: string; truncated: boolean; maxTokens: number };

// Generation budget in output tokens (not a sequence position). The engine
// reports when it is exhausted via stream_hit_length_limit.
export const CHAT_MAX_TOKENS = 1024;
export const FALLBACK_MAX_TOKENS = 512;

// elthur bakes the system prompt into the model at load time and ignores the
// per-call `system` argument afterwards, so every path loads with CHAT_SYSTEM
// (the fallback wording lives in the user message instead).
export const CHAT_SYSTEM =
  "You are Queen, a friendly assistant inside a chat app. " +
  "The user may or may not be logged in to Bee; if they ask for live " +
  "personal data you don't have, briefly suggest the /search or /today " +
  "commands. Otherwise just help directly from general knowledge. " +
  "Write in plain sentences, no code formatting. Keep it under 150 words.";

const enc = new TextEncoder();

function z(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 1);
  out.set(b, 0);
  out[out.length - 1] = 0;
  return out;
}

// The model is created once (loading from the appended blob) and reused; the
// engine resets its context per stream_start_model call. Note: elthur bakes the
// system prompt into the model at load time — the `system` argument to the
// stream_* calls is ignored once a model exists, so the first caller wins.
let model: Pointer | null = null;
let modelSystem: string | null = null;

function ensureModel(system: string = CHAT_SYSTEM): Pointer {
  if (model === null) {
    modelSystem = system;
    const systemZ = z(system);
    model = symbols.model_create_ex(systemZ, 512, 0.3, 0.9, 40);
    void systemZ;
    if (model === null) throw new EngineFailed();
  }
  return model;
}

/// The system prompt the engine model was loaded with (null before first use).
export function engineModelSystem(): string | null {
  return modelSystem;
}

/// One engine turn. `role` is rendered verbatim by elthur's chat encoders, so
/// "user"/"assistant" multi-turn history works; unknown roles pass through too.
export type EngineMessage = { role: string; content: string };

/// Low-level entry point: start a streamed generation over an arbitrary message
/// list, optionally declaring an OpenAI-style tools JSON array. The returned
/// handle is drained with pollStream() and freed with freeStream().
export function beginStream(
  messages: EngineMessage[],
  system: string,
  toolsJson: string | null,
  maxTokens: number,
): Pointer {
  const m = ensureModel(system);
  // ChatMessageC { role: char*, content: char* } — 16 bytes per message.
  const zipped = messages.map((msg) => ({ role: z(msg.role), content: z(msg.content) }));
  const msgs = new BigUint64Array(messages.length * 2);
  for (let i = 0; i < messages.length; i++) {
    const p = zipped[i]!;
    msgs[i * 2] = BigInt(ptr(p.role));
    msgs[i * 2 + 1] = BigInt(ptr(p.content));
  }
  const systemZ = z(system);
  const toolsZ = toolsJson !== null ? z(toolsJson) : null;
  const handle = toolsZ
    ? symbols.stream_start_model_ex(m, msgs, messages.length, systemZ, toolsZ, maxTokens, 0.3, 0.9, 40)
    : symbols.stream_start_model(m, msgs, messages.length, systemZ, maxTokens, 0.3, 0.9, 40);
  // Keep backing buffers alive across the call (sync, but be explicit).
  void zipped;
  void msgs;
  void systemZ;
  void toolsZ;
  if (handle === null) throw new EngineFailed();
  return handle;
}

/// One poll step: >0 bytes written into `out`, 0 idle, -1 done, -2 error.
export function pollStream(handle: Pointer, out: Uint8Array): number {
  return Number(symbols.stream_poll(handle, out, out.length));
}

/// Parsed tool calls for a finished stream (empty when none).
export function toolCallsOf(handle: Pointer): ToolCall[] {
  return readToolCalls(handle);
}

/// Whether generation stopped at the output-token budget rather than EOS.
export function streamTruncated(handle: Pointer): boolean {
  return symbols.stream_hit_length_limit(handle);
}

/// Release a stream handle (cancels the engine thread and joins it).
export function freeStream(handle: Pointer): void {
  symbols.stream_free(handle);
}

function start(prompt: string, system: string, maxTokens: number): Pointer {
  return beginStream([{ role: "user", content: prompt }], system, null, maxTokens);
}

/// Raw single-turn generation. Returns the engine's text; throws EngineFailed
/// on NULL. Blocks the calling thread (drains the stream synchronously).
export function generate(prompt: string, system: string, maxTokens: number): string {
  const handle = start(prompt, system, maxTokens);
  const out = new Uint8Array(65536);
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const n = Number(symbols.stream_poll(handle, out, out.length));
      if (n === -2) throw new EngineFailed();
      if (n > 0) text += decoder.decode(out.subarray(0, n), { stream: true });
      else if (n === -1) break;
      else Bun.sleepSync(5);
    }
    text += decoder.decode();
    return text;
  } finally {
    symbols.stream_free(handle);
  }
}

/// Free-form chat generation (larger budget than the fallback path).
export function chatGenerate(prompt: string): string {
  return generate(prompt, CHAT_SYSTEM, 256);
}

/// Streaming generation. Calls onChunk with the full text so far as tokens
/// arrive; resolves with the complete text and whether the token budget cut it
/// off. Never blocks the event loop: the engine runs on its own thread and TS
/// polls, so spinners animate and esc cancels mid-stream.
export async function streamGenerate(
  prompt: string,
  system: string,
  maxTokens: number,
  onChunk: (textSoFar: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<StreamResult> {
  const handle = start(prompt, system, maxTokens);
  const out = new Uint8Array(65536);
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      if (isCancelled()) throw new EngineCancelled();
      const n = Number(symbols.stream_poll(handle, out, out.length));
      if (n === -2) throw new EngineFailed();
      if (n > 0) {
        text += decoder.decode(out.subarray(0, n), { stream: true });
        onChunk(text);
      } else if (n === -1) {
        break;
      } else {
        await Bun.sleep(30);
      }
    }
    const truncated = symbols.stream_hit_length_limit(handle);
    text += decoder.decode();
    onChunk(text);
    return { text, truncated, maxTokens };
  } finally {
    symbols.stream_free(handle);
  }
}

/// Streaming free-form chat.
export function streamChat(
  prompt: string,
  onChunk: (textSoFar: string) => void,
  isCancelled?: () => boolean,
): Promise<StreamResult> {
  return streamGenerate(prompt, CHAT_SYSTEM, CHAT_MAX_TOKENS, onChunk, isCancelled);
}

/// A finished tool-enabled generation: the text plus any parsed calls.
export type ToolStreamResult = StreamResult & { toolCalls: ToolCall[] };

function readToolCalls(handle: Pointer): ToolCall[] {
  const raw = symbols.stream_tool_calls(handle);
  if (raw === null) return [];
  const json = new CString(raw).toString();
  symbols.free_string(raw);
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ToolCall[]) : [];
  } catch {
    return [];
  }
}

/// Streaming generation with tools. The engine renders the tools into the
/// prompt (Qwen system preamble, LFM system tool list) and returns parsed calls
/// once generation finishes.
export async function streamGenerateWithTools(
  prompt: string,
  system: string,
  maxTokens: number,
  toolsJson: string,
  onChunk: (textSoFar: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<ToolStreamResult> {
  const m = ensureModel(system);
  const role = z("user");
  const content = z(prompt);
  const systemZ = z(system);
  const toolsZ = z(toolsJson);
  const msgs = new BigUint64Array(2);
  msgs[0] = BigInt(ptr(role));
  msgs[1] = BigInt(ptr(content));
  const handle = symbols.stream_start_model_ex(m, msgs, 1, systemZ, toolsZ, maxTokens, 0.3, 0.9, 40);
  // Keep backing buffers alive across the call (sync, but be explicit).
  void role;
  void content;
  void systemZ;
  void toolsZ;
  if (handle === null) throw new EngineFailed();

  const out = new Uint8Array(65536);
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      if (isCancelled()) throw new EngineCancelled();
      const n = Number(symbols.stream_poll(handle, out, out.length));
      if (n === -2) throw new EngineFailed();
      if (n > 0) {
        text += decoder.decode(out.subarray(0, n), { stream: true });
        onChunk(text);
      } else if (n === -1) {
        break;
      } else {
        await Bun.sleep(30);
      }
    }
    const truncated = symbols.stream_hit_length_limit(handle);
    text += decoder.decode();
    onChunk(text);
    return { text, truncated, maxTokens, toolCalls: readToolCalls(handle) };
  } finally {
    symbols.stream_free(handle);
  }
}

/// Streaming chat with the queen tool surface.
export function streamChatWithTools(
  prompt: string,
  toolsJson: string,
  onChunk: (textSoFar: string) => void,
  isCancelled?: () => boolean,
): Promise<ToolStreamResult> {
  return streamGenerateWithTools(prompt, CHAT_SYSTEM, CHAT_MAX_TOKENS, toolsJson, onChunk, isCancelled);
}

/// Streaming logged-out fallback. Engine failure becomes the static text
/// (same contract as friendlyLoggedOut).
export async function streamFallback(
  attempted: string,
  detail: string,
  onChunk: (textSoFar: string) => void,
  isCancelled?: () => boolean,
): Promise<StreamResult> {
  const userMsg =
    `The user ran ${attempted} while logged out of Bee. ${detail} ` +
    "Write a short friendly message for them in plain sentences.";
  try {
    return await streamGenerate(userMsg, CHAT_SYSTEM, FALLBACK_MAX_TOKENS, onChunk, isCancelled);
  } catch (e) {
    if (e instanceof EngineCancelled) throw e;
    const text =
      "You're logged out of Bee, so I can't pull live data right now. " +
      "Run /login in this chat to connect your account, and I'll fetch it live. " +
      "Meanwhile, ask me anything and I'll help from general knowledge.";
    onChunk(text);
    return { text, truncated: false, maxTokens: FALLBACK_MAX_TOKENS };
  }
}

/// Friendly logged-out message for an attempted command. Never returns
/// empty — engine NULL becomes a short static fallback.
export function friendlyLoggedOut(attempted: string, detail: string): string {
  const userMsg =
    `The user ran ${attempted} while logged out of Bee. ${detail} ` +
    "Write a short friendly message for them in plain sentences.";
  try {
    return generate(userMsg, CHAT_SYSTEM, 128);
  } catch {
    return (
      "You're logged out of Bee, so I can't pull live data right now. " +
      "Run /login in this chat to connect your account, and I'll fetch it live. " +
      "Meanwhile, ask me anything and I'll help from general knowledge."
    );
  }
}
