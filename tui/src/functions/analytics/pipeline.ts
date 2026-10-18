import { adequacy } from "./adequacy";
import { dailyFactorMeans, factorDrift, nameFactors, runFactor, type FactorModel, type FactorName } from "./factors";
import { computeConversationMetrics, DIM_NAMES, toConversationInputs, varianceFilter, windowConversation } from "./metrics";
import { buildDays, type RealDay } from "./simulate";
import { DAY_MS, resolveTimeZone, startOfDay } from "./time";
import { round } from "./text";
import type {
  ConversationMetrics,
  DayPoint,
  RawData,
  TopicKey,
  WindowRow,
} from "./types";
import { TOPIC_KEYS } from "./types";

const DIM_ABBREV: Record<string, string> = {
  log_words: "logw",
  q_rate: "q",
  filler_rate: "filler",
  afinn_mean: "afinn",
  neg_rate: "neg",
  i_rate: "i",
  you_rate: "you",
  we_rate: "we",
  future_rate: "fut",
  travel_rate: "trav",
  food_rate: "food",
  tech_rate: "tech",
  social_rate: "soc",
  non_en_rate: "mixed",
};

const abbrevDim = (name: string): string =>
  DIM_ABBREV[name] ?? name.replace(/_(rate|words|mean)$/, "").slice(0, 5);

const REFERENCE_LOADINGS: number[][] = [
  [0.64, 0.10, -0.05, 0.08, 0.48],
  [0.67, -0.05, 0.37, -0.06, -0.12],
  [-0.63, 0.02, 0.10, -0.43, 0.06],
  [0.05, 0.08, -0.63, 0.05, 0.29],
  [0.08, -0.04, 0.63, -0.54, -0.08],
  [-0.10, -0.67, 0.07, -0.09, 0.52],
  [0.51, -0.44, 0.34, 0.04, -0.15],
  [0.06, 0.86, -0.05, 0.07, 0.11],
  [0.37, 0.12, -0.10, 0.41, 0.05],
  [0.05, 0.46, 0.04, -0.05, -0.09],
  [-0.07, 0.41, -0.44, -0.37, 0.33],
  [0.10, 0.06, 0.08, 0.10, -0.47],
  [0.04, 0.39, 0.30, 0.59, 0.38],
  [-0.73, -0.08, 0.06, 0.34, 0.07],
]; //TODO: Just some hardcoded values for a sim, these will be overwritten on more data, used as a empty state

export type Loadings = { dims: string[]; factors: string[]; values: number[][] };

export type AnalyticsResult = {
  period: { startMs: number; endMs: number; label: string };
  days: DayPoint[];
  loadings: Loadings;
  drift: number[];
  kmo: number | null;
  bartlett: { chi2: number; df: number; p: number } | null;
  realDays: number;
  simDays: number;
  factorNames: FactorName[];
};

export type AnalyticsOptions = { realOnly: boolean };

function fmtAfinn(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
}

function factType(text: string): string {
  const t = text.toLowerCase();
  if (/\b(will|plan|planning|trip|upcoming|next|tomorrow|november|going to|around)\b/.test(t)) return "plan";
  if (/\b(ritual|wind-down|bedtime|asleep|routine)\b/.test(t)) return "ritual";
  if (/\b(prefers?|likes?|finds?)\b/.test(t)) return "state";
  if (/\b(regularly|keeps?|always|enjoys?|has a strong)\b/.test(t)) return "trait";
  return "state";
}

function daysSlice(days: DayPoint[], realOnly: boolean): DayPoint[] {
  return realOnly ? days.filter((d) => d.real) : days;
}

export function runAnalytics(raw: RawData, opts: AnalyticsOptions, nowMs = Date.now()): AnalyticsResult {
  const timeZone = resolveTimeZone(raw.timeZone);
  const convs = toConversationInputs(raw);
  const metrics = convs.map((conv) => computeConversationMetrics(conv, timeZone));
  const windows = convs.flatMap((conv) => windowConversation(conv, timeZone));

  let model: FactorModel | null = null;
  let keepDims: string[] = [...DIM_NAMES];
  if (windows.length >= 4) {
    const { matrix, keep } = varianceFilter(windows.map((w) => w.dims));
    model = runFactor(matrix, 5);
    keepDims = keep.map((j) => DIM_NAMES[j] ?? `d${j}`);
  }

  const realByDay = new Map<string, RealDay>();
  const perDayFactor = model ? dailyFactorMeans(windows, model) : new Map<string, number[]>();
  const moodAcc = new Map<string, { sum: number; w: number }>();
  for (const m of metrics) {
    const key = m.dateKey;
    const entry = realByDay.get(key) ?? {
      mins: 0,
      utts: 0,
      topics: { travel: 0, work: 0, social: 0, food: 0, health: 0, tech: 0 } as Record<TopicKey, number>,
      factors: null,
      hourCounts: new Array<number>(24).fill(0),
      mood: 0,
    };
    entry.mins = round(entry.mins + m.mins, 1);
    entry.utts += m.utts;
    for (const k of TOPIC_KEYS) entry.topics[k] = round(entry.topics[k] + m.topicMinutes[k], 1);
    for (const [h, c] of Object.entries(m.hourHist)) entry.hourCounts[Number(h)] = (entry.hourCounts[Number(h)] ?? 0) + c;
    const ma = moodAcc.get(key) ?? { sum: 0, w: 0 };
    const weight = Math.max(1, m.words);
    ma.sum += m.afinn * weight;
    ma.w += weight;
    moodAcc.set(key, ma);
    realByDay.set(key, entry);
  }
  for (const [key, factors] of perDayFactor) {
    const entry = realByDay.get(key);
    if (entry) entry.factors = factors;
  }
  for (const [key, ma] of moodAcc) {
    const entry = realByDay.get(key);
    if (entry && ma.w > 0) entry.mood = round(ma.sum / ma.w, 3);
  }

  const allDays = buildDays(realByDay, nowMs, timeZone);
  const days = daysSlice(allDays, opts.realOnly);
  const realDays = allDays.filter((d) => d.real).length;
  const simDays = allDays.length - realDays;

  const loadings: Loadings = model
    ? { dims: keepDims, factors: Array.from({ length: model.k }, (_, i) => `F${i + 1}`), values: model.loadings }
    : { dims: [...DIM_NAMES], factors: ["F1", "F2", "F3", "F4", "F5"], values: REFERENCE_LOADINGS };
  const factorNames = nameFactors(loadings.dims, loadings.values, loadings.factors.length);

  const drift = model ? factorDrift(windows.map((w) => w.dims), 5) : [];
  const adeq = windows.length >= 4 ? adequacy(windows.map((w) => w.dims)) : null;
  const periodLabel = `${allDays[0]?.label ?? "?"}–${allDays.at(-1)?.label ?? "?"}`;

  return {
    period: { startMs: startOfDay(nowMs, timeZone) - 29 * DAY_MS, endMs: startOfDay(nowMs, timeZone), label: periodLabel },
    days,
    loadings,
    factorNames,
    drift,
    kmo: adeq?.kmo ?? null,
    bartlett: adeq?.bartlett ?? null,
    realDays,
    simDays,
  };
}

