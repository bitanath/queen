export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

//MARK: - Just a small utility for stopwords
export const STOPWORDS: Set<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "of", "to", "in", "for", "on", "with", "at", "by", "from", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "as", "not", "no", "do", "does", "did", "done", "have", "has",
  "had", "i", "im", "you", "your", "we", "our", "they", "he", "she", "him", "her", "his",
]);

export function countIn(tokensList: string[], set: Set<string>): number {
  let n = 0;
  for (const t of tokensList) if (set.has(t)) n += 1;
  return n;
}

export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
