import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SearchMode = "neural" | "keyword";

export type QueenConfig = {
  autoDiarization: boolean;
  showRelevanceScores: boolean;
  searchMode: SearchMode;
};

export const DEFAULT_CONFIG: QueenConfig = {
  autoDiarization: true,
  showRelevanceScores: true,
  searchMode: "neural",
};

function configDir(): string {
  const override = process.env["BEE_CONFIG_DIR"];
  return override && override.trim().length > 0 ? override : join(homedir(), ".bee");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseSearchMode(value: unknown): SearchMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "neural" || normalized === "semantic") return "neural";
  if (normalized === "keyword" || normalized === "bm25") return "keyword";
  return undefined;
}

function readFileConfig(): Record<string, unknown> {
  try {
    const path = configPath();
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function loadConfig(): QueenConfig {
  const file = readFileConfig();
  return {
    autoDiarization: parseBoolean(
      process.env["QUEEN_AUTO_DIARIZATION"] ?? file["autoDiarization"],
      DEFAULT_CONFIG.autoDiarization,
    ),
    showRelevanceScores: parseBoolean(
      process.env["QUEEN_SHOW_RELEVANCE"] ?? file["showRelevanceScores"],
      DEFAULT_CONFIG.showRelevanceScores,
    ),
    searchMode:
      parseSearchMode(process.env["QUEEN_SEARCH_MODE"])
      ?? parseSearchMode(file["searchMode"])
      ?? DEFAULT_CONFIG.searchMode,
  };
}


export function withSearchDefaults(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const args = input as Record<string, unknown>;
  if (args["mode"] !== undefined || args["filter"] !== undefined || args["sortBy"] !== undefined) {
    return input;
  }
  return loadConfig().searchMode === "neural" ? { ...args, mode: "semantic" } : input;
}
