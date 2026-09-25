import { CString, dlopen, ptr, type Pointer } from "bun:ffi";
import libPath from "../libelthur.dylib" with { type: "file" };

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
  // isize stream_poll(void* handle, char* out, size_t cap)
  //     bytes written, 0 idle, -1 done, -2 error
  stream_poll: { args: ["ptr", "ptr", "usize"], returns: "i64" },
  stream_free: { args: ["ptr"], returns: "void" },
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

const FALLBACK_SYSTEM =
  "You are Queen, a friendly offline assistant inside a chat app. " +
  "The user is not logged in to Bee, so no live Bee data is available. " +
  "Explain briefly that running /login in this chat unlocks live data, then help " +
  "with their request as best you can from general knowledge. " +
  "Write in plain sentences, no code formatting. Keep it under 120 words.";

const CHAT_SYSTEM =
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
// engine resets its context per stream_start_model call.
let model: Pointer | null = null;

function ensureModel(): Pointer {
  if (model === null) {
    const systemZ = z(CHAT_SYSTEM);
    model = symbols.model_create_ex(systemZ, 512, 0.3, 0.9, 40);
    void systemZ;
    if (model === null) throw new EngineFailed();
  }
  return model;
}

// ChatMessageC { role: char*, content: char* } — 16 bytes, u64-aligned.
function start(prompt: string, system: string, maxTokens: number): Pointer {
  const m = ensureModel();
  const role = z("user");
  const content = z(prompt);
  const systemZ = z(system);
  const msgs = new BigUint64Array(2);
  msgs[0] = BigInt(ptr(role));
  msgs[1] = BigInt(ptr(content));
  const handle = symbols.stream_start_model(m, msgs, 1, systemZ, maxTokens, 0.3, 0.9, 40);
  // Keep backing buffers alive across the call (sync, but be explicit).
  void role;
  void content;
  void systemZ;
  if (handle === null) throw new EngineFailed();
  return handle;
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
/// arrive; resolves with the complete text. Never blocks the event loop: the
/// engine runs on its own thread and TS polls, so spinners animate and esc
/// cancels mid-stream.
export async function streamGenerate(
  prompt: string,
  system: string,
  maxTokens: number,
  onChunk: (textSoFar: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<string> {
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
    text += decoder.decode();
    onChunk(text);
    return text;
  } finally {
    symbols.stream_free(handle);
  }
}

/// Streaming free-form chat.
export function streamChat(
  prompt: string,
  onChunk: (textSoFar: string) => void,
  isCancelled?: () => boolean,
): Promise<string> {
  return streamGenerate(prompt, CHAT_SYSTEM, 256, onChunk, isCancelled);
}

/// Streaming logged-out fallback. Engine failure becomes the static text
/// (same contract as friendlyLoggedOut).
export async function streamFallback(
  attempted: string,
  detail: string,
  onChunk: (textSoFar: string) => void,
  isCancelled?: () => boolean,
): Promise<string> {
  const userMsg =
    `The user ran ${attempted} while logged out of Bee. ${detail} ` +
    "Write a short friendly message for them in plain sentences.";
  try {
    return await streamGenerate(userMsg, FALLBACK_SYSTEM, 128, onChunk, isCancelled);
  } catch (e) {
    if (e instanceof EngineCancelled) throw e;
    const text =
      "You're logged out of Bee, so I can't pull live data right now. " +
      "Run /login in this chat to connect your account, and I'll fetch it live. " +
      "Meanwhile, ask me anything and I'll help from general knowledge.";
    onChunk(text);
    return text;
  }
}

/// Friendly logged-out message for an attempted command. Never returns
/// empty — engine NULL becomes a short static fallback.
export function friendlyLoggedOut(attempted: string, detail: string): string {
  const userMsg =
    `The user ran ${attempted} while logged out of Bee. ${detail} ` +
    "Write a short friendly message for them in plain sentences.";
  try {
    return generate(userMsg, FALLBACK_SYSTEM, 128);
  } catch {
    return (
      "You're logged out of Bee, so I can't pull live data right now. " +
      "Run /login in this chat to connect your account, and I'll fetch it live. " +
      "Meanwhile, ask me anything and I'll help from general knowledge."
    );
  }
}
