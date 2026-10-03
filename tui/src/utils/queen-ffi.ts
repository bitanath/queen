import { CString, dlopen, ptr, type Pointer } from "bun:ffi";
import libPath from "../../libelthur.dylib" with {type: "file"};
import type { ToolCall } from "./tool-definitions";

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

export type StreamResult = { text: string; truncated: boolean; maxTokens: number };


export const CHAT_MAX_TOKENS = 1024;
export const FALLBACK_MAX_TOKENS = 512;


export const CHAT_SYSTEM =
  "You are Queen, a friendly assistant inside a chat app. " +
  "The user may or may not be logged in to Bee; if they ask for live " +
  "personal data you don't have, briefly suggest the /search or /today " +
  "commands. Otherwise just help directly from general knowledge. " +
  "Write in plain sentences, no code formatting. Keep it under 150 words."; //TODO elthur bakes sysprompt model at load -> ignores per-call `system` arg 

const enc = new TextEncoder();

function encodeString(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 1);
  out.set(b, 0);
  out[out.length - 1] = 0;
  return out;
}

let model: Pointer | null = null;

function ensureModel(system: string = CHAT_SYSTEM): Pointer {
  if (model === null) {
    const systemZ = encodeString(system);
    model = symbols.model_create_ex(systemZ, 512, 0.3, 0.9, 40);
    void systemZ;
    if (model === null) throw new EngineFailed();
  }
  return model;
}


export type EngineMessage = { role: string; content: string };

export function beginStream( messages: EngineMessage[], system: string, toolsJson: string | null, maxTokens: number, ): Pointer {
  const m = ensureModel(system);
  const zipped = messages.map((msg) => ({ role: encodeString(msg.role), content: encodeString(msg.content) }));
  const msgs = new BigUint64Array(messages.length * 2);
  for (let i = 0; i < messages.length; i++) {
    const p = zipped[i]!;
    msgs[i * 2] = BigInt(ptr(p.role));
    msgs[i * 2 + 1] = BigInt(ptr(p.content));
  }
  const systemZ = encodeString(system);
  const toolsZ = toolsJson !== null ? encodeString(toolsJson) : null;
  const handle = toolsZ
    ? symbols.stream_start_model_ex(m, msgs, messages.length, systemZ, toolsZ, maxTokens, 0.3, 0.9, 40)
    : symbols.stream_start_model(m, msgs, messages.length, systemZ, maxTokens, 0.3, 0.9, 40);
  
  void zipped;
  void msgs;
  void systemZ;
  void toolsZ;
  if (handle === null) throw new EngineFailed();
  return handle;
}


export function pollStream(handle: Pointer, out: Uint8Array): number {
  return Number(symbols.stream_poll(handle, out, out.length));
}

export function toolCallsOf(handle: Pointer): ToolCall[] {
  return readToolCalls(handle);
}


export function streamTruncated(handle: Pointer): boolean {
  return symbols.stream_hit_length_limit(handle);
}

export function freeStream(handle: Pointer): void {
  symbols.stream_free(handle);
}

function start(prompt: string, system: string, maxTokens: number): Pointer {
  return beginStream([{ role: "user", content: prompt }], system, null, maxTokens);
}

//NOTE this is the raw generation function for a single turn
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

export function chatGenerate(prompt: string): string {
  return generate(prompt, CHAT_SYSTEM, 256);
}

export async function streamGenerate( prompt: string, system: string, maxTokens: number, onChunk: (textSoFar: string) => void, isCancelled: () => boolean = () => false): Promise<StreamResult> {
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


export async function streamGenerateWithTools(prompt: string, system: string, maxTokens: number, toolsJson: string, onChunk: (textSoFar: string) => void, isCancelled: () => boolean = () => false): Promise<ToolStreamResult> {
  const m = ensureModel(system);
  const role = encodeString("user");
  const content = encodeString(prompt);
  const systemZ = encodeString(system);
  const toolsZ = encodeString(toolsJson);
  const msgs = new BigUint64Array(2);
  msgs[0] = BigInt(ptr(role));
  msgs[1] = BigInt(ptr(content));
  const handle = symbols.stream_start_model_ex(m, msgs, 1, systemZ, toolsZ, maxTokens, 0.3, 0.9, 40);
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

export function streamChatWithTools(prompt: string, toolsJson: string, onChunk: (textSoFar: string) => void, isCancelled?: () => boolean): Promise<ToolStreamResult> {
  return streamGenerateWithTools(prompt, CHAT_SYSTEM, CHAT_MAX_TOKENS, toolsJson, onChunk, isCancelled);
}

export async function streamFallback( attempted: string, detail: string, onChunk: (textSoFar: string) => void, isCancelled?: () => boolean): Promise<StreamResult> {
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


