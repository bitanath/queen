import { valence } from "./afinn";
import { ENGLISH } from "./english";
import { FILLER, FUT_W, I_W, TOPIC_LEXICONS, WE_W, YOU_W } from "./lexicons";
import { countIn, round, STOPWORDS, tokens } from "./text";
import { dateKey, localHour } from "./time";
import type {
  ConversationInput,
  ConversationMetrics,
  RawData,
  TopicKey,
  WindowRow,
} from "./types";
import { TOPIC_KEYS } from "./types";

const BASE_DIM_NAMES = [
  "log_words", "q_rate", "filler_rate", "afinn_mean", "neg_rate", "i_rate", "you_rate",
  "we_rate", "future_rate", "non_en_rate",
] as const;

const DIM_NAMES: string[] = [...BASE_DIM_NAMES, ...TOPIC_KEYS.map((k) => `${k}_rate`)];
export { DIM_NAMES, BASE_DIM_NAMES };

/** Rate of tokens that are not common English words (code-mixing / ASR garble). */
function nonEnglishCount(tokensList: string[]): number {
  let n = 0;
  for (const t of tokensList) {
    if (t.length > 1 && !STOPWORDS.has(t) && !ENGLISH.has(t)) n += 1;
  }
  return n;
}

export function toConversationInputs(raw: RawData): ConversationInput[] {
  const out: ConversationInput[] = [];
  for (const conv of raw.conversations) {
    const id = String(conv.id);
    const said = raw.transcripts[id] ?? [];
    const utterances = said
      .map((u) => {
        const text = typeof u.text === "string" ? u.text.trim() : "";
        const at = u.spoken_at ?? 0;
        return { text, at, ...(typeof u.end === "number" ? { end: u.end } : {}) };
      })
      .filter((u) => u.text.length > 0 && u.at > 0)
      .sort((a, b) => a.at - b.at);
    if (utterances.length === 0) continue;
    const start = typeof conv.start_time === "number" ? conv.start_time : utterances[0]!.at;
    const end = typeof conv.end_time === "number" && conv.end_time > start ? conv.end_time : (utterances.at(-1)!.at ?? start) + 60_000;
    out.push({ id, start, end, utterances });
  }
  return out;
}

function topTokens(all: string[], limit: number): string[] {
  const freq = new Map<string, number>();
  for (const t of all) {
    if (t.length <= 2 || STOPWORDS.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

export function computeConversationMetrics(conv: ConversationInput, timeZone?: string): ConversationMetrics {
  const utts = conv.utterances;
  const n = utts.length;
  const mins = Math.max(0, (conv.end - conv.start) / 60_000);
  const allTokens = utts.flatMap((u) => tokens(u.text));
  const wn = allTokens.length;
  const words = utts.reduce((sum, u) => sum + u.text.split(/\s+/).filter(Boolean).length, 0);
  const qCount = utts.filter((u) => u.text.trim().endsWith("?")).length;
  const fillCount = countIn(allTokens, FILLER);
  const afinnSum = allTokens.reduce((sum, t) => sum + valence(t), 0);
  const iCount = countIn(allTokens, I_W);
  const nonEnCount = nonEnglishCount(allTokens);

  const topicCounts = {} as Record<TopicKey, number>;
  for (const k of TOPIC_KEYS) topicCounts[k] = countIn(allTokens, TOPIC_LEXICONS[k]);
  const totalTopic = TOPIC_KEYS.reduce((s, k) => s + topicCounts[k], 0);

  const topicMinutes = {} as Record<TopicKey, number>;
  for (const k of TOPIC_KEYS) {
    topicMinutes[k] = totalTopic > 0 ? round((mins * topicCounts[k]) / totalTopic, 1) : 0;
  }
  let topTopic: TopicKey | null = null;
  let best = 0;
  for (const k of TOPIC_KEYS) {
    if (topicCounts[k] > best) {
      best = topicCounts[k];
      topTopic = k;
    }
  }

  const hourHist: Record<number, number> = {};
  for (const u of utts) {
    const h = localHour(u.at, timeZone);
    hourHist[h] = (hourHist[h] ?? 0) + 1;
  }

  return {
    id: conv.id,
    dateKey: dateKey(conv.start, timeZone),
    start: conv.start,
    end: conv.end,
    mins: round(mins, 1),
    utts: n,
    words,
    wpm: mins > 0 ? round(words / mins, 1) : 0,
    upm: mins > 0 ? round(n / mins, 1) : 0,
    qPct: n > 0 ? round((100 * qCount) / n, 1) : 0,
    fillPct: n > 0 ? round((100 * fillCount) / n, 1) : 0,
    afinn: wn > 0 ? round(afinnSum / wn, 3) : 0,
    iPct: wn > 0 ? round((100 * iCount) / wn, 1) : 0,
    nonEnPct: wn > 0 ? round((100 * nonEnCount) / wn, 1) : 0,
    top: topTokens(allTokens, 8),
    topTopic,
    topicMinutes,
    hourHist,
  };
}

function pct(tokensList: string[], set: Set<string>, wn: number): number {
  return wn > 0 ? (100 * countIn(tokensList, set)) / wn : 0;
}

//TODO: We do not process all conversations at a time
export function windowConversation(conv: ConversationInput, timeZone?: string): WindowRow[] {
  const utts = conv.utterances;
  const n = utts.length;
  if (n < 8) return [];
  const rows: WindowRow[] = [];
  const starts: number[] = [];
  for (let s = 0; s + 10 <= n; s += 3) starts.push(s);
  if (starts.length === 0) starts.push(0); // 8–9 utterances → one window
  else if (starts.at(-1)! + 10 < n) starts.push(n - 10);

  for (const s of starts) {
    const w = utts.slice(s, s + 10);
    if (w.length < 8) continue;
    const all = w.flatMap((u) => tokens(u.text));
    const wn = all.length;
    const nUtt = w.length;
    const qCount = w.filter((u) => u.text.trim().endsWith("?")).length;
    const fillCount = countIn(all, FILLER);
    const afinnSum = all.reduce((sum, t) => sum + valence(t), 0);
    const negCount = all.reduce((sum, t) => (valence(t) < 0 ? 1 : 0), 0);
    const words = w.reduce((sum, u) => sum + u.text.split(/\s+/).filter(Boolean).length, 0);

    const qPct = nUtt > 0 ? (100 * qCount) / nUtt : 0;
    const iPct = pct(all, I_W, wn);
    const wePct = pct(all, WE_W, wn);
    const nonEnPct = wn > 0 ? (100 * nonEnglishCount(all)) / wn : 0;

    const dims = [
      Math.log(words + 1),
      qPct,
      nUtt > 0 ? (100 * fillCount) / nUtt : 0,
      wn > 0 ? afinnSum / wn : 0,
      wn > 0 ? (100 * negCount) / wn : 0,
      iPct,
      pct(all, YOU_W, wn),
      wePct,
      pct(all, FUT_W, wn),
      nonEnPct,
      ...TOPIC_KEYS.map((k) => pct(all, TOPIC_LEXICONS[k], wn)),
    ];

    const mid = w[Math.floor(w.length / 2)]!;
    rows.push({
      convId: conv.id,
      at: mid.at,
      dateKey: dateKey(mid.at, timeZone),
      text: w.slice(0, 3).map((u) => u.text).join(" ").slice(0, 120),
      dims,
      qPct,
      iPct,
      wePct,
      nonEnPct,
    });
  }
  return rows;
}


export function varianceFilter(matrix: number[][]): { matrix: number[][]; keep: number[] } {
  if (matrix.length === 0) return { matrix, keep: [] };
  const p = matrix[0]!.length;
  const keep: number[] = [];
  for (let j = 0; j < p; j += 1) {
    const col = matrix.map((row) => row[j] ?? 0);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / col.length);
    if (sd > 1e-9) keep.push(j);
  }
  if (keep.length === p) return { matrix, keep };
  return { matrix: matrix.map((row) => keep.map((j) => row[j] ?? 0)), keep };
}
