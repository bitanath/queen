import { CString, dlopen, ptr, type Pointer } from "bun:ffi";
import libPath from "../../libelthur.dylib" with {type: "file"};
import type { ToolCall } from "../functions/tool-definitions";
import { CHAT_SYSTEM_HIGH, modelParams } from "../functions/model-params";
import type {
  BeginStreamOptions,
  EngineMessage,
  FallbackOptions,
  GenerateOptions,
  StreamOptions,
  StreamResult,
} from "./interfaces-types";

export type { EngineMessage, StreamResult } from "./interfaces-types";

//NOTE elthur's C API surface we leverage this 
const { symbols } = dlopen(libPath, {
  model_create_ex: { args: ["cstring", "i32", "f64", "f64", "i32"], returns: "ptr" },
  model_generate: { args: ["ptr", "cstring"], returns: "ptr" },
  model_free: { args: ["ptr"], returns: "void" },
  stream_start_model: {
    args: ["ptr", "ptr", "usize", "cstring", "i32", "f64", "f64", "i32"],
    returns: "ptr",
  },
  stream_start_model_ex: {
    args: ["ptr", "ptr", "usize", "cstring", "cstring", "i32", "f64", "f64", "i32"],
    returns: "ptr",
  },
  stream_tool_calls: { args: ["ptr"], returns: "ptr" },
  stream_poll: { args: ["ptr", "ptr", "usize"], returns: "i64" }, // poll: >0 bytes written, 0 idle, -1 done, -2 error.
  stream_free: { args: ["ptr"], returns: "void" },
  stream_hit_length_limit: { args: ["ptr"], returns: "bool" },
  stream_prompt_tokens: { args: ["ptr"], returns: "usize" },
  stream_ttft_nanoseconds: { args: ["ptr"], returns: "u64" },
  free_string: { args: ["ptr"], returns: "void" },
});

export class EngineFailed extends Error {
  constructor() {
    super("Engine returned NULL");
    this.name = "EngineFailed";
  }
}

export class EngineCancelled extends Error {
  constructor() {
    super("elthur generation cancelled");
    this.name = "EngineCancelled";
  }
}

export const CHAT_MAX_TOKENS = 1024;
export const FALLBACK_MAX_TOKENS = 512;
const DEFAULT_GENERATE_MAX_TOKENS = 256;

/** Static logged-out reply, used when no local model is available to rewrite it. */
export const OFFLINE_NOTICE =
  "You're logged out of Bee, so I can't pull live data right now. " +
  "Run /login in this chat to connect your account, and I'll fetch it live. " +
  "Meanwhile, ask me anything and I'll help from general knowledge.";


const enc = new TextEncoder();

function encodeString(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 1);
  out.set(b, 0);
  out[out.length - 1] = 0;
  return out;
}

let model: Pointer | null = null;

const systemPrompt = () => modelParams().systemPrompt ?? CHAT_SYSTEM_HIGH;

function ensureModel(system: string = systemPrompt()): Pointer {
  if (model === null) {
    const p = modelParams();
    const systemZ = encodeString(system);
    model = symbols.model_create_ex(systemZ, 512, p.temperature, p.topP, p.topK);
    void systemZ;
    if (model === null) throw new EngineFailed();
  }
  return model;
}

export function beginStream(opts: BeginStreamOptions): Pointer {
  const m = ensureModel(opts.system);
  const zipped = opts.messages.map((msg) => ({ role: encodeString(msg.role), content: encodeString(msg.content) }));
  const msgs = new BigUint64Array(opts.messages.length * 2);
  for (let i = 0; i < opts.messages.length; i++) {
    const p = zipped[i]!;
    msgs[i * 2] = BigInt(ptr(p.role));
    msgs[i * 2 + 1] = BigInt(ptr(p.content));
  }
  const systemZ = encodeString(opts.system);
  const toolsZ = opts.toolsJson != null ? encodeString(opts.toolsJson) : null;
  const p = modelParams();
  const handle = toolsZ
    ? symbols.stream_start_model_ex(m, msgs, opts.messages.length, systemZ, toolsZ, opts.maxTokens, p.temperature, p.topP, p.topK)
    : symbols.stream_start_model(m, msgs, opts.messages.length, systemZ, opts.maxTokens, p.temperature, p.topP, p.topK);

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

/** Number of prompt tokens the last generation had to prefill. */
export function promptTokensOf(handle: Pointer): number {
  return Number(symbols.stream_prompt_tokens(handle));
}

/** Time to first token (prefill) in milliseconds for the last generation. */
export function ttftMsOf(handle: Pointer): number {
  return Math.round(Number(symbols.stream_ttft_nanoseconds(handle)) / 1e6);
}

/**
 * Load the weights ahead of the first user turn so the first message doesn't
 * pay the model-load latency. Safe to call more than once.
 */
export function warmModel(system?: string): void {
  ensureModel(system);
}

function start(prompt: string, system: string, maxTokens: number): Pointer {
  return beginStream({ messages: [{ role: "user", content: prompt }], system, maxTokens });
}

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

//MARK : - Raw generation functions for the model
export function generate(opts: GenerateOptions): string {
  const handle = start(opts.prompt, opts.system ?? systemPrompt(), opts.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS);
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

export async function streamGenerate(opts: StreamOptions): Promise<StreamResult> {
  const handle = start(opts.prompt, opts.system ?? systemPrompt(), opts.maxTokens ?? CHAT_MAX_TOKENS);
  const isCancelled = opts.isCancelled ?? (() => false);
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
        opts.onChunk(text);
      } else if (n === -1) {
        break;
      } else {
        await Bun.sleep(30);
      }
    }
    const truncated = symbols.stream_hit_length_limit(handle);
    text += decoder.decode();
    opts.onChunk(text);
    return { text, truncated, maxTokens: opts.maxTokens ?? CHAT_MAX_TOKENS };
  } finally {
    symbols.stream_free(handle);
  }
}

export async function streamFallback(opts: FallbackOptions): Promise<StreamResult> {
  const userMsg =
    `The user ran ${opts.attempted} while logged out of Bee. ${opts.detail} ` +
    "Write a short friendly message for them in plain sentences.";
  try {
    return await streamGenerate({
      prompt: userMsg,
      system: systemPrompt(),
      maxTokens: FALLBACK_MAX_TOKENS,
      onChunk: opts.onChunk,
      ...(opts.isCancelled ? { isCancelled: opts.isCancelled } : {}),
    });
  } catch (e) {
    if (e instanceof EngineCancelled) throw e;
    const text = OFFLINE_NOTICE;
    opts.onChunk(text);
    return { text, truncated: false, maxTokens: FALLBACK_MAX_TOKENS };
  }
}
