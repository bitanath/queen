import type { CommandContext } from "@/commands/types";
import { createDeveloperClient } from "@/client";
import { fetchClientMe } from "@/client/clientMe";
import { requestClientJson } from "@/client/clientApi";

import { createCommandContext } from "@/context";
import { callBeeTextTool } from "@/commands/mcpToolOutput";
import { getEnvironmentConfig, type Environment } from "@/environment";
import { todayResource } from "@/resources/today";
import { clearPairingState, clearProxyConfig, clearToken, loadPairingState, loadToken, savePairingState, saveToken, } from "@/secureStore";
import { requestAppPairing } from "@/commands/auth/appPairingRequest";
import { decryptAppPairingToken, generateAppPairingKeyPair, } from "@/utils/appPairingCrypto";
import { renderQrCode } from "@/utils/qrCode";
import { resolveTimeZone } from "@/utils/markdown";
import { nowCommand } from "@/commands/now";
import { changedCommand } from "@/commands/changed";
import type { TableSpec } from "./table-spec";
import type { AnswerView, SearchResult, TranscriptLine } from "./answer-view";

import type {
  LoginOptions,
  PairingOptions,
  PollPairingOptions,
  SearchBeeOptions,
} from "./interfaces-types";

const BEE_CLI_SHA = process.env.QUEEN_BEE_SHA ?? "dev"; //NOTE Pinned bee-cli submodule (`git -C bee-cli rev-parse HEAD`); "dev" when run unbundled.
const ELTHUR_SHA = process.env.QUEEN_ELTHUR_SHA ?? "dev"; //NOTE elthur revision this build used (usually latest main); "dev" when run unbundled.

// Queen keeps Bee credentials in ~/.bee/ only — never the macOS keychain — so we
// never trigger a keychain access prompt. Defensive: preload sets this too, but
// this guarantees file-only for anything importing the bridge directly.
process.env.BEE_FORCE_FILE_STORE ??= "1";

export class NotLoggedIn extends Error {
  constructor() {
    super('Not logged in. Run /login first.');
    this.name = "NotLoggedIn";
  }
}

export function isNotLoggedIn(err: unknown): boolean {
  return (
    err instanceof NotLoggedIn ||
    (err instanceof Error && /not logged in/i.test(err.message))
  );
}

let cached: { env: Environment; ctx: CommandContext } | null = null;

export async function beeContext(env: Environment = "prod"): Promise<CommandContext> {
  if (!cached || cached.env !== env) {
    cached = { env, ctx: await createCommandContext(env) };
  }
  return cached.ctx;
}

export function dropBeeContext(): void {
  cached = null;
}

/** Cheap login probe: proxy mode, or a stored token for the environment. */
export async function isLoggedIn(env: Environment = "prod"): Promise<boolean> {
  const ctx = await beeContext(env);
  if (ctx.client.isProxy) return true;
  return Boolean(await loadToken(env));
}

export type StatusInfo = {
  apiLabel: string;
  apiUrl: string;
  connected: boolean;
  tokenMask: string | null;
  verifiedName: string | null;
  verifiedId: number | null;
  viaProxy: string | null;
  beeCliSha: string;
  elthurSha: string;
};

export async function getStatus(env: Environment = "prod"): Promise<StatusInfo> {
  const ctx = await beeContext(env);
  const config = getEnvironmentConfig(env);
  const proxyAddress = ctx.client.isProxy ? ctx.client.proxyAddress : undefined;

  if (proxyAddress) {
    const user = await fetchClientMe(ctx);
    return {
      apiLabel: config.label,
      apiUrl: config.apiUrl,
      connected: true,
      tokenMask: null,
      verifiedName: [user.first_name, user.last_name].filter(Boolean).join(" "),
      verifiedId: user.id,
      viaProxy: proxyAddress,
      beeCliSha: BEE_CLI_SHA,
      elthurSha: ELTHUR_SHA,
    };
  }

  const token = await loadToken(env);
  if (!token) throw new NotLoggedIn();

  const user = await fetchClientMe(ctx, token);
  return {
    apiLabel: config.label,
    apiUrl: config.apiUrl,
    connected: true,
    tokenMask: maskToken(token),
    verifiedName: [user.first_name, user.last_name].filter(Boolean).join(" "),
    verifiedId: user.id,
    viaProxy: null,
    beeCliSha: BEE_CLI_SHA,
    elthurSha: ELTHUR_SHA,
  };
}

export function renderStatusMd(s: StatusInfo): string {
  const lines = [
    `API: ${s.apiLabel} (${s.apiUrl})`,
    `bee-cli: ${s.beeCliSha.slice(0, 12)}`,
    `elthur: ${s.elthurSha.slice(0, 12)}`,
  ];
  if (s.viaProxy) lines.push(`Connected via proxy: ${s.viaProxy}`);
  if (s.tokenMask) lines.push(`Token: ${s.tokenMask}`);
  if (s.verifiedName) lines.push(`Verified as ${s.verifiedName} (id ${s.verifiedId}).`);
  return lines.join("\n");
}

function maskToken(token: string): string {
  const t = token.trim();
  return t.length <= 8 ? "********" : `${t.slice(0, 4)}...${t.slice(-4)}`;
}

export type CommandResult = { text: string; view?: AnswerView };

type Rec = Record<string, unknown>;

const META_KEYS = new Set(["next_cursor", "cursor", "timezone", "time_zone"]);

// Drop id-ish columns and pagination/meta keys from tables.
function isMetaKey(key: string): boolean {
  const k = key.toLowerCase();
  return META_KEYS.has(k) || k === "id" || k.endsWith("_id");
}

function isDateKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "date" ||
    k === "at" ||
    k === "since" ||
    k === "until" ||
    k === "from" ||
    k === "to" ||
    k.endsWith("_at") ||
    k.endsWith("_time") ||
    k.endsWith("_date")
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return toEpochMs(Number(value));
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function calendarLabel(year: number, month: number, day: number, nowMs: number): string {
  const now = new Date(nowMs);
  if (year === now.getFullYear()) {
    if (month === now.getMonth() && day === now.getDate()) return "today";
    return `${ordinal(day)} ${MONTH_NAMES[month]}`;
  }
  if (year === now.getFullYear() - 1) return "last year";
  return String(year);
}

/** Friendly relative/calendar date for table cells ("2 days ago", "20th August", "last year"). */
export function humanDate(value: unknown, nowMs: number = Date.now()): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return calendarLabel(year ?? 0, (month ?? 1) - 1, day ?? 1, nowMs);
  }
  const ms = toEpochMs(value);
  if (ms === null) return value === null || value === undefined ? "" : String(value);

  const seconds = (nowMs - ms) / 1000;
  if (seconds >= 0) {
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 14) return "last week";
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  }
  const d = new Date(ms);
  return calendarLabel(d.getFullYear(), d.getMonth(), d.getDate(), nowMs);
}

// Recursively drop null/undefined values (no more "- x: n/a").
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    const out: Rec = {};
    for (const [key, val] of Object.entries(value as Rec)) {
      if (val === null || val === undefined) continue;
      out[key] = prune(val);
    }
    return out;
  }
  return value;
}

// Collapse whitespace into a single line; the table wraps it by column width.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cell(value: unknown, key: string, timeZone: string, nowMs: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isDateKey(key) && (typeof value === "number" || typeof value === "string")) {
    return oneLine(humanDate(value, nowMs));
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return oneLine(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    return oneLine(value.map((item) => cell(item, key, timeZone, nowMs)).join(", "));
  }
  return oneLine(JSON.stringify(value));
}

function isObjectArray(value: unknown): value is Rec[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))
  );
}

/**
 * Turn a Bee payload into a table: the first list of objects becomes the rows
 * (id/meta columns dropped), otherwise the record becomes a key/value table.
 */
export function buildTable(data: unknown): TableSpec | undefined {
  const root = prune(data);
  if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
  const record = root as Rec;
  const timeZone = resolveTimeZone(typeof record["timezone"] === "string" ? record["timezone"] : null);
  const nowMs = Date.now();

  for (const [key, value] of Object.entries(record)) {
    if (isMetaKey(key) || !isObjectArray(value)) continue;
    const items = value;
    const colSet = new Set<string>();
    for (const item of items) {
      for (const k of Object.keys(item)) {
        if (!isMetaKey(k)) colSet.add(k);
      }
    }
    let columns = [...colSet];
    if (columns.length === 0) continue;

    // Drop duplicate/noise columns so the text columns get room to breathe.
    const drop = new Set<string>();
    if (columns.includes("summary") && columns.includes("short_summary")) drop.add("short_summary");
    if (columns.includes("created_at") && columns.includes("updated_at")) drop.add("updated_at");
    if (columns.includes("start_time") && columns.includes("end_time")) drop.add("end_time");
    columns = columns.filter((col) => {
      if (drop.has(col)) return false;
      // Noise: "unknown"/empty/"(none)" in every row.
      return items.some((item) => {
        const text = cell(item[col], col, timeZone, nowMs).trim().toLowerCase();
        return text !== "" && text !== "unknown" && text !== "(none)";
      });
    });
    if (columns.length === 0) continue;

    let rows = items.map((item) => columns.map((col) => cell(item[col], col, timeZone, nowMs)));

    // Mixed feeds (e.g. activity) have sparse columns; keep only those present in
    // at least half the rows so the table stays readable.
    const keep = columns.map((_, i) =>
      rows.reduce((n, row) => n + ((row[i] ?? "").trim().length > 0 ? 1 : 0), 0) >= Math.ceil(rows.length / 2),
    );
    if (keep.some(Boolean) && !keep.every(Boolean)) {
      columns = columns.filter((_, i) => keep[i]);
      rows = rows.map((row) => row.filter((_, i) => keep[i]));
    }
    return { title: key, columns, rows };
  }

  const entries = Object.entries(record).filter(([key]) => !isMetaKey(key));
  if (entries.length === 0) return undefined;
  return {
    title: "details",
    columns: ["field", "value"],
    rows: entries.map(([key, value]) => [key, cell(value, key, timeZone, nowMs)]),
  };
}

function tableResult(title: string, table: TableSpec | undefined): CommandResult {
  if (!table) return { text: title };
  const isFields = table.columns[0] === "field";
  const n = table.rows.length;
  const noun = isFields ? (n === 1 ? "field" : "fields") : n === 1 ? "row" : "rows";
  return { text: `${title} · ${n} ${noun}`, view: { title, table: { ...table, title } } };
}

export async function getMe(env: Environment = "prod"): Promise<CommandResult> {
  const ctx = await beeContext(env);
  const data = await requestClientJson(ctx, "/v1/me", { method: "GET" });
  return tableResult("Profile", buildTable(parseProfile(data)));
}

function parseTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const tz = (value as { timezone?: unknown }).timezone;
  return typeof tz === "string" ? tz : null;
}

function parseProfile(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { first_name: "n/a", last_name: "n/a" };
  }
  const r = payload as { first_name?: unknown; last_name?: unknown; timezone?: unknown };
  return {
    first_name: typeof r.first_name === "string" ? r.first_name : "n/a",
    last_name: typeof r.last_name === "string" ? r.last_name : "n/a",
    timezone: typeof r.timezone === "string" ? r.timezone : "n/a",
  };
}

export async function searchBee(opts: SearchBeeOptions): Promise<CommandResult> {
  const ctx = await beeContext(opts.env ?? "prod");
  const data = await callBeeTextTool(ctx, "bee_search", { query: opts.query, limit: opts.limit ?? 5 });
  const results = parseSearchResults(data);
  return {
    text: `Bee Search · ${results.length} ${results.length === 1 ? "result" : "results"}`,
    view: { title: `Search · ${opts.query}`, results },
  };
}

type RawSearchResult = {
  id?: unknown;
  type?: unknown;
  score?: unknown;
  title_snippet?: unknown;
  snippet?: unknown;
  summary?: unknown;
  created_at?: unknown;
};

function parseSearchResults(data: unknown): SearchResult[] {
  const root = data && typeof data === "object" ? (data as { results?: unknown }) : {};
  const list = Array.isArray(root.results) ? root.results : [];
  const nowMs = Date.now();
  return list
    .map((item): SearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as RawSearchResult;
      const title =
        typeof r.title_snippet === "string"
          ? r.title_snippet
          : typeof r.summary === "string"
            ? r.summary
            : "";
      return {
        id: typeof r.id === "string" ? r.id : String(r.id ?? ""),
        type: typeof r.type === "string" ? r.type : "result",
        score: typeof r.score === "number" ? r.score : 0,
        when: humanDate(r.created_at, nowMs),
        title: oneLine(title.replace(/^#{1,6}\s+/, "")),
        snippet: oneLine((typeof r.snippet === "string" ? r.snippet : "").replace(/^#{1,6}\s+/, "")),
      };
    })
    .filter((result): result is SearchResult => result !== null);
}

const DETAIL_TOOLS: Record<string, string> = {
  fact: "bee_get_fact",
  daily: "bee_get_daily_summary",
  conversation: "bee_get_conversation",
  insight: "bee_get_insight",
  journal: "bee_get_voice_note",
  voice_note: "bee_get_voice_note",
};

function unwrapRecord(data: unknown): Rec {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const record = data as Rec;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Rec;
    }
  }
  return record;
}

function textField(record: Rec, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

const NOISE = /^(unknown|n\/a|none|\(none\)|null|undefined)$/i;

function isNoise(value: string): boolean {
  return value.trim().length === 0 || NOISE.test(value.trim());
}

function detailMeta(record: Rec): { key: string; value: string }[] {
  const items: { key: string; value: string }[] = [];
  const push = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (isNoise(text)) return;
    items.push({ key, value: text });
  };
  const when = record["created_at"] ?? record["start_time"] ?? record["date_time"] ?? record["date"];
  if (when !== undefined) push("when", humanDate(when));
  push("state", record["state"]);
  push("device", record["device_type"]);
  if (typeof record["confirmed"] === "boolean") push("confirmed", record["confirmed"] ? "yes" : "no");
  if (Array.isArray(record["tags"]) && record["tags"].length > 0) push("tags", record["tags"].join(", "));
  push("utterances", record["utterances_count"]);
  return items;
}

function toMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  // Epoch ms passes through; seconds (epoch or audio offset) become ms.
  return value > 1e12 ? value : value * 1000;
}

function transcriptLines(record: Rec): TranscriptLine[] {
  const transcriptions = record["transcriptions"];
  if (!Array.isArray(transcriptions)) return [];
  const lines: TranscriptLine[] = [];
  for (const item of transcriptions) {
    if (!item || typeof item !== "object") continue;
    const utterances = (item as Rec)["utterances"];
    if (!Array.isArray(utterances)) continue;
    for (const utterance of utterances) {
      if (!utterance || typeof utterance !== "object") continue;
      const u = utterance as Rec;
      const raw = typeof u["speaker"] === "string" ? u["speaker"].trim() : "";
      const speaker = raw.length > 0 && !isNoise(raw) ? raw : "Speaker";
      const text = typeof u["text"] === "string" ? u["text"].trim() : "";
      if (!text) continue;
      const at = toMs(u["start"]) ?? toMs(u["spoken_at"]);
      const end = toMs(u["end"]);
      lines.push({
        speaker,
        text,
        ...(at !== undefined ? { at } : {}),
        ...(end !== undefined ? { end } : {}),
      });
    }
  }
  return lines;
}

/** Fetch the full entity behind a search hit for the drill-down view. */
export async function getResultDetail(result: SearchResult): Promise<AnswerView> {
  const tool = DETAIL_TOOLS[result.type.toLowerCase()];
  if (!tool) throw new Error(`No detail view for ${result.type}`);
  const ctx = await beeContext("prod");
  const input: Record<string, unknown> = { id: result.id };
  if (tool === "bee_get_conversation") input.includeTranscript = true;
  const data = await callBeeTextTool(ctx, tool, input);
  const record = unwrapRecord(data);
  const body = textField(record, ["summary", "text", "short_summary"]).trim();
  const transcript = transcriptLines(record);
  return {
    title: `${result.type} · ${result.id}`,
    detail: {
      meta: detailMeta(record),
      ...(body ? { body } : {}),
      ...(transcript.length > 0 ? { transcript } : {}),
    },
  };
}

export async function getTodayBrief(env: Environment = "prod"): Promise<CommandResult> {
  const ctx = await beeContext(env);
  const briefAction = todayResource.actions[1];
  if (!briefAction) throw new Error("today resource missing brief action");
  const result = await briefAction.run(ctx, { context: false });
  if (result.kind !== "json") throw new Error("unexpected today result");
  return tableResult("Today Brief", buildTable(result.data));
}

export async function getTodayContext(env: Environment = "prod"): Promise<CommandResult> {
  const ctx = await beeContext(env);
  const data = await callBeeTextTool(ctx, "bee_get_today", {});
  return tableResult("Today", buildTable(data));
}

// Run a bee-cli command that prints to stdout and capture what it printed.
export async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n").trim();
}

// List-style Bee tools all share this shape: call the tool, tabulate the record.
async function beeList(
  env: Environment,
  tool: string,
  title: string,
  input: Record<string, unknown> = {},
): Promise<CommandResult> {
  const ctx = await beeContext(env);
  const data = await callBeeTextTool(ctx, tool, input);
  return tableResult(title, buildTable(data));
}

export const getActivity = (env: Environment = "prod") =>
  beeList(env, "bee_get_recent_activity", "Recent Activity");
export const listConversations = (env: Environment = "prod") =>
  beeList(env, "bee_list_conversations", "Conversations");
export const listDailySummaries = (env: Environment = "prod") =>
  beeList(env, "bee_list_daily_summaries", "Daily Summaries");
export const listFacts = (env: Environment = "prod") =>
  beeList(env, "bee_list_facts", "Facts");
export const getInsights = (env: Environment = "prod") =>
  beeList(env, "bee_get_insights", "Insights");
export const listJournals = (env: Environment = "prod") =>
  beeList(env, "bee_list_voice_notes", "Journals");
export const getLocations = (env: Environment = "prod", current = false) =>
  current
    ? beeList(env, "bee_get_current_location", "Current Location")
    : beeList(env, "bee_get_location_clusters", "Location Clusters");

/** Recent conversations with utterances (runs the bee-cli `now` command). */
export async function getNow(env: Environment = "prod"): Promise<string> {
  const ctx = await beeContext(env);
  return captureConsole(() => nowCommand.run([], ctx));
}

/** Recently changed entities (runs the bee-cli `changed` command). */
export async function getChanged(env: Environment = "prod", cursor?: string): Promise<string> {
  const ctx = await beeContext(env);
  const args = cursor ? ["--cursor", cursor] : [];
  return captureConsole(() => changedCommand.run(args, ctx));
}

export async function loginWithToken(opts: LoginOptions): Promise<string> {
  const clean = opts.token.trim();
  if (!clean) throw new Error("Missing token.");
  const env = opts.env ?? "prod";
  const ctx = await beeContext(env);
  const apiCtx: CommandContext = { ...ctx, client: createDeveloperClient(env) };
  const user = await fetchClientMe(apiCtx, clean);
  await saveToken(env, clean);
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}

export type PairingStart = {
  pairingUrl: string;
  expiresAt: string;
  resumed: boolean;
  qr: string | null;
};

function defaultAppId(env: Environment): string {
  return env === "staging" ? "pk5z3uuzjpxj4f7frk6rsq2f" : "ph9fssu1kv1b0hns69fxf7rx";
}

export async function startPairing(opts: PairingOptions = {}): Promise<PairingStart> {
  const env = opts.env ?? "prod";
  const withQr = opts.withQr ?? false;
  const existing = await loadPairingState(env);
  if (existing) {
    const exp = Date.parse(existing.expiresAt);
    if (!Number.isNaN(exp) && Date.now() < exp) {
      return {
        pairingUrl: existing.pairingUrl,
        expiresAt: existing.expiresAt,
        resumed: true,
        qr: withQr ? await renderQrCode(existing.pairingUrl) : null,
      };
    }
    await clearPairingState(env);
  }

  const appId = defaultAppId(env);
  const keyPair = generateAppPairingKeyPair();
  const initial = await requestAppPairing(env, appId, keyPair.publicKeyBase64);
  if (initial.status === "completed") {
    const token = decryptAppPairingToken(initial.encryptedToken, keyPair.secretKey);
    await saveToken(env, token);
    throw new Error("ALREADY_PAIRED");
  }
  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }
  const pairingUrl = `https://bee.computer/connect#${initial.requestId}`;
  await savePairingState(env, {
    appId,
    publicKey: keyPair.publicKeyBase64,
    secretKey: Buffer.from(keyPair.secretKey).toString("base64"),
    requestId: initial.requestId,
    pairingUrl,
    expiresAt: initial.expiresAt,
  });
  return {
    pairingUrl,
    expiresAt: initial.expiresAt,
    resumed: false,
    qr: withQr ? await renderQrCode(pairingUrl) : null,
  }; // NOTE Does NOT poll — call pollPairing() after.
}

export type PairingOutcome = { name: string };

export async function pollPairing(opts: PollPairingOptions = {}): Promise<PairingOutcome> {
  const env = opts.env ?? "prod";
  const isCancelled = opts.isCancelled ?? (() => false);
  const state = await loadPairingState(env);
  if (!state) throw new Error("No pairing session. Run /login first.");
  const expMs = Date.parse(state.expiresAt);
  const deadline = Number.isNaN(expMs) || expMs <= 0 ? Date.now() + 5 * 60 * 1000 : expMs;
  const secretKey = new Uint8Array(Buffer.from(state.secretKey, "base64"));

  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("Pairing cancelled.");
    const outcome = await requestAppPairing(env, state.appId, state.publicKey);
    if (outcome.status === "completed") {
      const token = decryptAppPairingToken(outcome.encryptedToken, secretKey);
      const ctx = await beeContext(env);
      const apiCtx: CommandContext = { ...ctx, client: createDeveloperClient(env) };
      const user = await fetchClientMe(apiCtx, token);
      await saveToken(env, token);
      await clearPairingState(env);
      return { name: [user.first_name, user.last_name].filter(Boolean).join(" ") };
    }
    if (outcome.status === "expired") {
      await clearPairingState(env);
      throw new Error("Pairing request expired. Please try again.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Login timed out. Please try again.");
}

export async function logout(env: Environment = "prod"): Promise<void> {
  await clearProxyConfig(env);
  await clearToken(env);
  await clearPairingState(env);
  dropBeeContext();
}


