export const CHAT_SYSTEM = "You are Queen, a friendly assistant inside a chat app. " +
  "The user may or may not be logged in to Bee; if they ask for live " +
  "personal data you don't have, briefly suggest the /search or /today " +
  "commands. Otherwise just help directly from general knowledge. " +
  "Write in plain sentences, no code formatting. Keep it under 150 words."; //TODO Change this to fit Bee needs


export type ModelParams = {
  temperature: number;
  topP: number;
  topK: number;
};

const DEFAULTS: ModelParams = { temperature: 0.3, topP: 0.9, topK: 40 };

const BY_FAMILY: Record<string, ModelParams> = {
  "qwen3.5": { temperature: 0.6, topP: 0.85, topK: 20 },
  minicpm5: { temperature: 0.3, topP: 0.9, topK: 40 },
};

export function modelParams(
  family: string | undefined = process.env.QUEEN_MODEL_FAMILY,
): ModelParams {
  if (!family) return DEFAULTS;
  return BY_FAMILY[family] ?? DEFAULTS;
}

