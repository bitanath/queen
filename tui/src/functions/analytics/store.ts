import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AnalyticsResult, AnalyticsOptions } from "./pipeline";
import { runAnalytics } from "./pipeline";
import { fetchRawAnalyticsData } from "./fetch";
import type { RawData } from "./types";

export type AnalyticsStatus = "idle" | "loading" | "ready" | "error";

export type AnalyticsState = {
  status: AnalyticsStatus;
  result: AnalyticsResult | null;
  error: string | null;
  realOnly: boolean;
  fetchedAt: number | null;
};

const CACHE_PATH = join(homedir(), ".bee", "queen-analytics.json");

let state: AnalyticsState = {
  status: "idle",
  result: null,
  error: null,
  realOnly: true, // simulated is off by default (ctrl+e toggles)
  fetchedAt: null,
};

let raw: RawData | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function setState(patch: Partial<AnalyticsState>) {
  state = { ...state, ...patch };
  emit();
}

function compute() {
  if (!raw) return;
  const opts: AnalyticsOptions = { realOnly: state.realOnly };
  try {
    const result = runAnalytics(raw, opts);
    setState({ result, status: "ready", error: null });
  } catch (e) {
    setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

type CacheFile = { fetchedAt: number; raw: RawData };

function readCache(): CacheFile | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    if (!parsed || typeof parsed !== "object" || !parsed.raw) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: RawData) {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), raw: data } satisfies CacheFile));
  } catch {
    // Cache is best-effort; analytics still work in-memory.
  }
}

async function load(forceFetch: boolean) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    setState({ status: "loading", error: null });
    try {
      if (!forceFetch) {
        const cache = readCache();
        if (cache) {
          raw = cache.raw;
          setState({ fetchedAt: cache.fetchedAt });
          compute();
          return;
        }
      }
      const fetched = await fetchRawAnalyticsData();
      raw = fetched;
      writeCache(fetched);
      setState({ fetchedAt: Date.now() });
      compute();
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function ensureAnalytics(): void {
  if (state.status === "idle") void load(false);
}

/** Re-fetch raw data from Bee and recompute (network). */
export function refreshAnalytics(): Promise<void> {
  return load(true);
}

/** Toggle simulated days off/on using cached raw data (no network). */
export function toggleRealOnly(): void {
  const realOnly = !state.realOnly;
  setState({ realOnly });
  compute();
}

export function getAnalytics(): AnalyticsState {
  return state;
}

export const analyticsCachePath = CACHE_PATH;

export function subscribeAnalytics(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
