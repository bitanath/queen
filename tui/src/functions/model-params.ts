export const CHAT_SYSTEM_HIGH = `
You are Queen, a friendly assistant inside a chat app.
The user may or may not be logged in to Bee; if they ask for live personal data you don't have, briefly suggest the /search or /today commands.
Otherwise just help directly from general knowledge.
Write in plain sentences, no code formatting. Keep it under 150 words.
`.trim();

export const CHAT_SYSTEM_LOW = `
You are Queen, a friendly assistant inside a chat app.
The user may or may not be logged in to Bee; if they ask for live personal data you don't have, briefly suggest the /search or /today commands.
Otherwise just help directly from general knowledge.
Write in plain sentences, no code formatting.
Only call a tool when the request actually needs live or external data; otherwise reply naturally and conversationally.
`.trim();

export type ModelParams = {
  temperature: number;
  topP: number;
  topK: number;
  systemPrompt?: string;
};

const DEFAULTS: ModelParams = {
  temperature: 0.3,
  topP: 0.9,
  topK: 40,
  systemPrompt: CHAT_SYSTEM_HIGH,
};

const BY_FAMILY: Record<string, ModelParams> = {
  "qwen3.5": { temperature: 0.6, topP: 0.85, topK: 20, systemPrompt: CHAT_SYSTEM_HIGH },
  "minicpm5": { temperature: 0.3, topP: 0.9, topK: 40, systemPrompt: CHAT_SYSTEM_HIGH },
  "lfm2.5": { temperature: 0.1, topP: 0.9, topK: 50, systemPrompt: CHAT_SYSTEM_LOW },
};

export function modelParams(
  family: string | undefined = process.env.QUEEN_MODEL_FAMILY,
): ModelParams {
  if (!family) return DEFAULTS;
  return BY_FAMILY[family] ?? DEFAULTS;
}
