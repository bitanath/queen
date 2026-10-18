import { factor } from "factor-js";
import { DIM_NAMES } from "./metrics";
import type { WindowRow } from "./types";

export type FactorModel = {
  k: number;
  dims: string[];
  scores: number[][];
  variance: number[];
  loadings: number[][];
};

export function runFactor(matrix: number[][], k = 5): FactorModel | null {
  if (matrix.length < 2 || (matrix[0]?.length ?? 0) < 2) return null;
  const res = factor(matrix);
  const p = matrix[0]!.length;
  const kk = Math.max(1, Math.min(k, p, matrix.length));
  const loadings = res.loadings.slice(0, p).map((row) => row.slice(0, kk));
  const scores = res.scores.map((row) => row.slice(0, kk));
  return { dims: [...DIM_NAMES], k: kk, loadings, scores, variance: res.variance.slice(0, kk) };
}

export function dailyFactorMeans(windows: WindowRow[], model: FactorModel): Map<string, number[]> {
  const acc = new Map<string, { sum: number[]; n: number }>();
  windows.forEach((w, i) => {
    const s = model.scores[i];
    if (!s) return;
    let entry = acc.get(w.dateKey);
    if (!entry) {
      entry = { sum: new Array<number>(model.k).fill(0), n: 0 };
      acc.set(w.dateKey, entry);
    }
    for (let j = 0; j < model.k; j += 1) entry.sum[j] = (entry.sum[j] ?? 0) + (s[j] ?? 0);
    entry.n += 1;
  });
  const out = new Map<string, number[]>();
  for (const [key, entry] of acc) out.set(key, entry.sum.map((x) => x / entry.n));
  return out;
}

export function factorDrift(matrix: number[][], k = 5): number[] {
  if (matrix.length < 4) return [];
  const half = Math.floor(matrix.length / 2);
  const a = runFactor(matrix.slice(0, half), k);
  const b = runFactor(matrix.slice(half), k);
  if (!a || !b) return [];
  const out: number[] = [];
  for (let f = 0; f < Math.min(a.k, b.k); f += 1) {
    let dot = 0; // TODO: Basically a cosine similarity of each factor's loading vector across period halves.
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.loadings.length; i += 1) {
      const x = a.loadings[i]?.[f] ?? 0;
      const y = b.loadings[i]?.[f] ?? 0;
      dot += x * y;
      ma += x * x;
      mb += y * y;
    }
    out.push(ma > 0 && mb > 0 ? Math.abs(dot / Math.sqrt(ma * mb)) : 0);
  }
  return out;
}

export const DIM_LABEL: Record<string, string> = {
  log_words: "verbosity",
  q_rate: "question-rate",
  filler_rate: "filler-rate",
  afinn_mean: "mood",
  neg_rate: "negative-rate",
  i_rate: "self-rate",
  you_rate: "other-rate",
  we_rate: "joint-rate",
  future_rate: "future-rate",
  travel_rate: "travel-rate",
  food_rate: "food-rate",
  tech_rate: "tech-rate",
  social_rate: "social-rate",
  non_en_rate: "non-english",
};

export const FACTOR_WORD: Record<string, string> = {
  log_words: "talkative",
  q_rate: "questioning",
  filler_rate: "filler-words",
  afinn_mean: "positive-mood",
  neg_rate: "negative-mood",
  i_rate: "self-focus",
  you_rate: "other-focus",
  we_rate: "joint-planning",
  future_rate: "future-plans",
  travel_rate: "travel-talk",
  food_rate: "food-talk",
  tech_rate: "tech-talk",
  social_rate: "social-talk",
  non_en_rate: "mixed-lang",
};

// Human-facing dimension names (title case) for the loadings table.
const BASE_DIM_DISPLAY: Record<string, string> = {
  log_words: "Verbosity",
  q_rate: "Question rate",
  filler_rate: "Fillers",
  afinn_mean: "Mood",
  neg_rate: "Negativity",
  i_rate: "Self-focus",
  you_rate: "Other-focus",
  we_rate: "Joint planning",
  future_rate: "Future plans",
  non_en_rate: "Mixed language",
};

const TOPIC_TITLE: Record<string, string> = {
  travel: "Travel",
  work: "Work",
  social: "Social",
  food: "Food",
  health: "Health",
  medical: "Medical",
  tech: "Tech",
  beauty: "Beauty",
  home: "Home",
  shopping: "Shopping",
  money: "Money",
  music: "Music",
  sport: "Sport",
  reading: "Reading",
  transport: "Transport",
  study: "Study",
  pets: "Pets",
  weather: "Weather",
  nature: "Nature",
};

const titleCase = (s: string): string =>
  s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Descriptive, title-case name for a dim (e.g. `non_en_rate` → "Mixed language"). */
export function dimDisplay(name: string): string {
  const base = BASE_DIM_DISPLAY[name];
  if (base) return base;
  const topic = /^(.+)_rate$/.exec(name);
  if (topic) return TOPIC_TITLE[topic[1]!] ?? titleCase(topic[1]!);
  return titleCase(name.replace(/_(rate|words|mean)$/, ""));
}

// Plain-English definitions for the non-obvious metrics shown in the footer.
const BASE_GLOSSARY: Record<string, string> = {
  log_words: "words spoken per window (verbosity)",
  q_rate: "share of utterances that are questions",
  filler_rate: "ums / ahs and filler words",
  afinn_mean: "average sentiment (mood)",
  neg_rate: "share of negatively-valenced words",
  i_rate: "share of \u201cI\u201d pronouns (self-focus)",
  you_rate: "share of \u201cyou\u201d pronouns (other-focus)",
  we_rate: "share of \u201cwe\u201d pronouns (joint planning)",
  future_rate: "future-tense words (plans)",
  non_en_rate: "words outside common English (code-mixing / ASR noise)",
};

/** One-line definition for a dim, or null when the name is self-explanatory. */
export function dimGlossary(name: string): string | null {
  return BASE_GLOSSARY[name] ?? null;
}

/** Whether a dim is a topic dimension (used to phrase the prose summary). */
export function dimIsTopic(name: string): boolean {
  return /^(.+)_rate$/.test(name) && name in TOPIC_TITLE;
}

/** Plain noun for a dim, as used in the prose summary (e.g. "Shopping"). */
export function dimNoun(name: string): string {
  const topic = /^(.+)_rate$/.exec(name);
  const t = topic ? TOPIC_TITLE[topic[1]!] : undefined;
  if (t) return t;
  return dimDisplay(name);
}

export type FactorName = { short: string; long: string };

export function nameFactors(dims: string[], values: number[][], k: number): FactorName[] {
  const desc = (dim: string) => FACTOR_WORD[dim] ?? DIM_LABEL[dim] ?? dim.replace(/_(rate|words|mean)$/, "");
  const out: FactorName[] = [];
  for (let f = 0; f < k; f += 1) {
    const strong = dims
      .map((dim, i) => ({ dim, v: values[i]?.[f] ?? 0 }))
      .filter((l) => Math.abs(l.v) >= 0.3)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    if (strong.length === 0) {
      out.push({ short: `Factor ${f + 1}`, long: `Factor ${f + 1}` });
      continue;
    }
    const short = desc(strong[0]!.dim);
    const pos = strong.filter((l) => l.v > 0).slice(0, 2).map((l) => desc(l.dim));
    const neg = strong.filter((l) => l.v < 0).slice(0, 1).map((l) => desc(l.dim));
    const long =
      pos.length > 0 && neg.length > 0
        ? `${pos.join(" + ")} / low ${neg.join(" + ")}`
        : pos.length > 0
          ? pos.join(" + ")
          : `low ${neg.join(" + ")}`;
    out.push({ short, long });
  }
  return out;
}
