export const CHAT_SYSTEM_HIGH = `
You are Queen, a friendly assistant in a chat app. Help from general knowledge; if asked for live personal data you don't have, briefly suggest /search or /today. Plain sentences, no code formatting, under 150 words.
`.trim();

export const ORCHESTRATOR_PROMPT = `
You are Queen. For anything about the user's own data or the web/shell, call route with the right specialist:
conversation (said/heard/did, today, transcripts, summaries), facts (saved facts), insights (patterns, and the user's profile via bee_me), journals (voice notes and locations), todos, files (sync, edit, photos), external (web, APIs, weather, shell), misc (anything unclear or unmatched; it only calls a matching tool or refuses).
Otherwise answer directly in plain sentences, no code formatting, under 150 words, only in English no other language.
`.trim();

export type ModelParams = {
  temperature: number;
  topP: number;
  topK: number;
  systemPrompt?: string;
  /** Engine/Strands context window in tokens. Fixed across families. */
  contextWindow: number;
  /** Sliding-window message budget. */
  windowSize: number;
  /**
   * Proactive compression threshold (fraction of context), or `undefined` to
   * disable proactive compression and rely on reactive trimming.
   */
  compressionThreshold?: number;
};

// elthur is built with a fixed 32768 context window (see elthur/core/*.zig), so
// every family advertises the same limit. Smaller models just fill it slower.
const CONTEXT_WINDOW = 32768;

const DEFAULTS: ModelParams = {
  temperature: 0.3,
  topP: 0.9,
  topK: 40,
  systemPrompt: CHAT_SYSTEM_HIGH,
  contextWindow: CONTEXT_WINDOW,
  windowSize: 40,
};

const BY_FAMILY: Record<string, ModelParams> = {
  "qwen3.5": {
    temperature: 0.6,
    topP: 0.85,
    topK: 20,
    systemPrompt: CHAT_SYSTEM_HIGH,
    contextWindow: CONTEXT_WINDOW,
    windowSize: 40, // no proactive compression for the larger model
  },
  "lfm2.5": {
    temperature: 0.1,
    topP: 0.9,
    topK: 50,
    systemPrompt: CHAT_SYSTEM_HIGH,
    contextWindow: CONTEXT_WINDOW,
    windowSize: 40,
  },
};

export function modelParams(
  family: string | undefined = process.env.QUEEN_MODEL_FAMILY,
): ModelParams {
  if (!family) return DEFAULTS;
  return BY_FAMILY[family] ?? DEFAULTS;
}


