import { DAY_MS, dateKey, dayLabel, partsIn, startOfDay } from "./time";
import type { DayPoint, TopicKey } from "./types";
import { TOPIC_KEYS } from "./types";
import { round } from "./text";

export type RealDay = {
  mins: number;
  utts: number;
  topics: Record<TopicKey, number>;
  factors: number[] | null;
  hourCounts: number[];
  mood: number;
};

const FRAME_DAYS = 30;

function makeRng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

//MARK: - random simulation for demo, this STRICTLY AUGMENTS our usage and does not recreate usage
function makeNormal(rnd: () => number) {
  return (m: number, s: number) => m + (rnd() + rnd() + rnd() - 1.5) * s;
}

function isWeekend(dateMs: number, timeZone?: string): boolean {
  const p = partsIn(dateMs, timeZone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return day === 0 || day === 6;
}

function hourCountsFor(utts: number, weekend: boolean, rnd: () => number, N: (m: number, s: number) => number): number[] {
  const counts = new Array<number>(24).fill(0);
  const pool = weekend
    ? [[11, 13], [17, 18.5], [20, 22]]
    : [[10, 11.5], [13, 14], [19, 21.5]];
  const n = 1 + Math.floor(rnd() * (weekend ? 3 : 2.4));
  const used = new Set<number>();
  const blobs: number[][] = [];
  for (let k = 0; k < n; k += 1) {
    let p = Math.floor(rnd() * pool.length);
    while (used.has(p)) p = (p + 1) % pool.length;
    used.add(p);
    blobs.push(pool[p]!);
  }
  blobs.sort((a, b) => a[0]! - b[0]!);
  const perBlob = Math.max(2, Math.round(utts / blobs.length));
  for (const [h0, h1] of blobs) {
    for (let h = Math.floor(h0!); h < Math.ceil(h1!); h += 1) {
      const frac = Math.min(h + 1, h1!) - Math.max(h, h0!);
      const value = Math.max(1, Math.round((perBlob * frac) / N(h1! - h0!, 0.001) * rnd() + (perBlob * frac) / (h1! - h0!)));
      if (h >= 0 && h < 24) counts[h] = (counts[h] ?? 0) + value;
    }
  }
  return counts;
}

export function buildDays(realByDay: Map<string, RealDay>, nowMs: number, timeZone?: string): DayPoint[] {
  const rnd = makeRng(7);
  const N = makeNormal(rnd);
  const todayStart = startOfDay(nowMs, timeZone);
  const days: DayPoint[] = [];

  for (let i = 0; i < FRAME_DAYS; i += 1) {
    const dateMs = todayStart - (FRAME_DAYS - 1 - i) * DAY_MS;
    const key = dateKey(dateMs, timeZone);
    const label = dayLabel(dateMs, timeZone);
    const weekend = isWeekend(dateMs, timeZone);
    const real = realByDay.get(key);

    if (real) {
      const factors = real.factors && real.factors.length > 0 ? real.factors : simulatedFactors(i, weekend, rnd, N);
      days.push({
        index: i,
        dateKey: key,
        label,
        real: true,
        mins: real.mins,
        utts: real.utts,
        topics: real.topics,
        factors,
        mood: real.mood,
        positivity: simulatedPositivity(i, weekend, N),
        hourCounts: real.hourCounts,
      });
      continue;
    }

    const mins = real ? 0 : round(Math.max(6, N(weekend ? 30 : 20, 8) + i * 0.25), 1);
    const utts = Math.round(mins * N(5, 0.8));
    const weights: Record<TopicKey, number> = {
      travel: 0.06 + (i >= 26 ? 0.075 * (i - 25) : 0),
      tech: 0.06,
      work: weekend ? 0.05 : 0.24,
      social: weekend ? 0.36 : 0.14,
      health: 0.16,
      food: 0.12,
    };
    const sum = TOPIC_KEYS.reduce((s, k) => s + weights[k], 0);
    const topics = {} as Record<TopicKey, number>;
    for (const k of TOPIC_KEYS) topics[k] = round((mins * weights[k]) / sum, 1);

    days.push({
      index: i,
      dateKey: key,
      label,
      real: false,
      mins,
      utts,
      topics,
      factors: simulatedFactors(i, weekend, rnd, N),
      mood: round((simulatedPositivity(i, weekend, N) - 52) / 40, 3),
      positivity: simulatedPositivity(i, weekend, N),
      hourCounts: hourCountsFor(utts, weekend, rnd, N),
    });
  }
  return days;
}

function simulatedFactors(i: number, weekend: boolean, rnd: () => number, N: (m: number, s: number) => number): number[] {
  const f1 = N(0.1 - 0.05 * (i / 29), 0.15);
  const f2base = i < 5 ? -2.66 + 0.1845 * i : i <= 16 ? -1.74 + 0.1845 * (i - 5) : 0.29 + 0.04 * (i - 16);
  const f3base = i < 5 ? 0.67 - 0.046 * i : i <= 16 ? 0.44 - 0.046 * (i - 5) : -0.07 - 0.003 * (i - 16);
  const f4base = i < 5 ? -1.58 + 0.109 * i : i <= 16 ? -1.03 + 0.109 * (i - 5) : 0.17 + 0.02 * (i - 16);
  const f5base = i < 5 ? 2.1 - 0.1445 * i : i <= 16 ? 1.38 - 0.1445 * (i - 5) : -0.21 - 0.01 * (i - 16);
  return [
    round(f1, 2),
    round(f2base + N(0, 0.09), 2),
    round(f3base + N(0, 0.12), 2),
    round(f4base + (weekend ? 0.35 : 0) + N(0, 0.12), 2),
    round(f5base + N(0, 0.09), 2),
  ];
}

function simulatedPositivity(i: number, weekend: boolean, N: (m: number, s: number) => number): number {
  return round(52 + 8 * (i / 29) + (weekend ? 4 : 0) + N(0, 3), 1);
}
