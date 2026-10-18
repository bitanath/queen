import { BeforeToolCallEvent } from "@strands-agents/sdk";

import { ElthurModel } from "../src/functions/strands-model";
import { ACTION_CATALOG } from "../src/functions/action/catalog";
import { actionTool } from "../src/functions/action/execute";
import { beeToolNames, ensureBeeMcp, invokeBeeTool, stopBeeMcp } from "../src/libraries/bee-mcp";
import { isLoggedIn } from "../src/utils/bee-com-bridge";
import { createQueenAgent, type AgentActivity } from "../src/functions/tools-execution";
import type { DocFilter, UiBridge } from "../src/functions/ui-bridge";
import { ROUTE_CASES, casesFor, HEURISTIC_CASES, classOf, type RouteCase } from "./cases";
import { automationToolNames } from "../src/functions/automation";
import { classifyRequest, withRouteHint } from "../src/functions/agents/orchestrator";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const TIERS = arg("tiers", "a").split(",").map((t) => t.trim()).filter(Boolean);
const OUT = arg("out", "/tmp/queen-harness.json");
const FILTER = arg("filter", "");
const LIVE = process.argv.includes("--live");

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Print a liveness line every few seconds while a long call runs. */
function heartbeat(label: string): () => void {
  const startedAt = Date.now();
  const id = setInterval(() => {
    log(`        … ${label} ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }, 5000);
  return () => clearInterval(id);
}

type Row = {
  tier: string;
  case: string;
  expect: string;
  actual: string;
  pass: boolean;
  ttftMs?: number;
  tokPerSec?: number;
  totalMs?: number;
  reply?: string;
  note?: string;
};

const rows: Row[] = [];
function record(row: Row): void {
  rows.push(row);
  const mark = row.pass ? "PASS" : "FAIL";
  const perf =
    row.ttftMs !== undefined
      ? `  ttft=${row.ttftMs}ms tok/s=${row.tokPerSec ?? "-"} total=${row.totalMs ?? "-"}ms`
      : "";
  log(`  ${mark}  [${row.tier}] ${row.case} → ${row.actual}${perf}${row.note ? `  (${row.note})` : ""}`);
  if (row.reply) log(`        reply: ${row.reply.replace(/\s+/g, " ").slice(0, 160)}`);
}

function messageText(message: { content?: readonly { type?: string; text?: unknown }[] }): string {
  return (message.content ?? [])
    .filter((b) => b.type === "textBlock")
    .map((b) => String(b.text ?? ""))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// MCP result parsing
// ---------------------------------------------------------------------------

function mcpText(value: unknown): string {
  const content = (value as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? "").join("\n");
  return typeof value === "string" ? value : JSON.stringify(value);
}

function mcpJson(value: unknown): unknown {
  try {
    return JSON.parse(mcpText(value));
  } catch {
    return undefined;
  }
}

function deepFindId(value: unknown): number | string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (rec.id !== undefined && rec.id !== null) return rec.id as number | string;
  for (const child of Object.values(rec)) {
    const id = deepFindId(child);
    if (id !== undefined) return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tier A — coverage gate
// ---------------------------------------------------------------------------

/** Commands handled server-side / as actions, not by a routed worker. */
const NON_CATALOG_RESOURCES = new Set([
  "mcp", "stream", "proxy", "sync", "login", "logout",
  "status", "today", "now", "changed", "me", "ping", "version",
]);
const EXTERNAL_COMMANDS = ["status", "today", "now", "changed", "me", "ping", "version"];

async function tierA(): Promise<void> {
  const tools = new Set(beeToolNames());

  // 1. Every catalog action either maps to a real Bee tool or is a known
  //    doc/external/chat action, and none references a missing tool.
  const missing = ACTION_CATALOG.filter((a) => actionTool(a) && !tools.has(actionTool(a)!));
  record({ tier: "A", case: "catalog → real tool", expect: "0 missing", actual: `${missing.length} missing`, pass: missing.length === 0 });
  record({ tier: "A", case: "bee tools discovered", expect: ">10", actual: String(tools.size), pass: tools.size > 10 });

  // 2. Coverage: every routable catalog resource has at least one manifest case.
  const resources = new Set(ACTION_CATALOG.map((a) => a.resource).filter((r) => !NON_CATALOG_RESOURCES.has(r)));
  for (const resource of resources) {
    const has = ROUTE_CASES.some((c) => c.id.startsWith(`catalog:${resource}:`));
    record({ tier: "A", case: `coverage catalog:${resource}`, expect: "case", actual: has ? "case" : "MISSING", pass: has });
  }

  // 3. Coverage: every external command has a case.
  for (const name of EXTERNAL_COMMANDS) {
    const has = ROUTE_CASES.some((c) => c.id === `ext:${name}`);
    record({ tier: "A", case: `coverage ext:${name}`, expect: "case", actual: has ? "case" : "MISSING", pass: has });
  }

  // 4. Coverage: every automation tool on this platform has a case.
  const autoCaseIds = new Set(ROUTE_CASES.filter((c) => c.id.startsWith("auto:")).map((c) => c.id));
  for (const name of automationToolNames()) {
    const has = autoCaseIds.has(`auto:${name}`);
    record({ tier: "A", case: `coverage auto:${name}`, expect: "case", actual: has ? "case" : "MISSING", pass: has });
  }

  record({ tier: "A", case: "manifest size", expect: "≥40", actual: String(ROUTE_CASES.length), pass: ROUTE_CASES.length >= 40 });

  // 5. Heuristic classifier (offline, no model).
  let heuristicPass = 0;
  for (const h of HEURISTIC_CASES) {
    const actual = classifyRequest(h.text, h.doc ?? null);
    const ok = actual === h.expected;
    if (ok) heuristicPass += 1;
    record({
      tier: "A",
      case: `heuristic: ${h.text}${h.doc ? ` [${h.doc}]` : ""}`,
      expect: h.expected,
      actual,
      pass: ok,
    });
  }
  record({
    tier: "A",
    case: "heuristic accuracy",
    expect: "100%",
    actual: `${heuristicPass}/${HEURISTIC_CASES.length}`,
    pass: heuristicPass === HEURISTIC_CASES.length,
  });
}

// ---------------------------------------------------------------------------
// Shared agent helpers
// ---------------------------------------------------------------------------

const NOOP_BRIDGE: UiBridge = {
  showDocuments: () => {},
  refreshDocuments: () => {},
  openAnswer: () => {},
  toast: () => {},
  login: () => {},
  clarify: async () => "bee",
};

/** A bridge that records the panel refreshes an action triggered. */
function recordingBridge(): UiBridge & { shown: DocFilter[]; refreshed: number; clarified: string[] } {
  const shown: DocFilter[] = [];
  const clarified: string[] = [];
  let refreshed = 0;
  return {
    shown,
    clarified,
    get refreshed() {
      return refreshed;
    },
    showDocuments: (filter) => {
      if (filter) shown.push(filter);
    },
    refreshDocuments: () => {
      refreshed += 1;
    },
    openAnswer: () => {},
    toast: () => {},
    login: () => {},
    clarify: async (question) => {
      clarified.push(question);
      return "bee";
    },
  };
}

/** Activity observer that also prints worker tool calls live. */
function activityLogger(sink: AgentActivity[]): (event: AgentActivity) => void {
  return (event) => {
    sink.push(event);
    if (event.kind === "tool") log(`        · ${event.agent} → ${event.name}`);
  };
}

// ---------------------------------------------------------------------------
// Tier B — routing over the manifest (side-effect free)
// ---------------------------------------------------------------------------

function expectedLabel(c: RouteCase): string {
  return c.agent === "none" ? "(no worker)" : c.agent;
}

function routedOk(c: RouteCase, picked: string[]): boolean {
  return c.agent === "none" ? picked.length === 0 : picked[0] === c.agent;
}

async function tierB(): Promise<void> {
  process.env.QUEEN_TEMPERATURE = process.env.QUEEN_TEMPERATURE ?? "0";
  const cases = casesFor(FILTER || undefined);
  let index = 0;
  for (const c of cases) {
    index += 1;
    const passing = rows.filter((r) => r.tier === "B" && r.pass).length;
    log(`  [B ${index}/${cases.length}/${passing}] → ${c.prompt}`);
    const model = new ElthurModel({ maxTokens: 256 });
    const agent = createQueenAgent(model, NOOP_BRIDGE);
    const picked: string[] = [];
    agent.addHook(BeforeToolCallEvent, (event) => {
      picked.push(event.toolUse.name);
      log(`        route → ${event.toolUse.name}`);
      event.cancel = "harness dry-run"; // never call the worker
    });
    const started = Date.now();
    const stop = heartbeat("model");
    try {
      await agent.invoke(withRouteHint(c.prompt));
    } catch (e) {
      stop();
      record({ tier: "B", case: c.id, expect: expectedLabel(c), actual: `error: ${e instanceof Error ? e.message : e}`, pass: false });
      Bun.gc(true);
      continue;
    }
    stop();
    record({
      tier: "B",
      case: c.id,
      expect: expectedLabel(c),
      actual: picked[0] ?? "(no tool)",
      pass: routedOk(c, picked),
      ttftMs: model.lastTtftMs,
      tokPerSec: model.lastTokPerSec,
      totalMs: Date.now() - started,
    });
    Bun.gc(true); // harness builds an agent per case; keep RSS flat
  }

  // By-class breakdown (recall / precision / ambiguous).
  for (const cls of ["recall", "precision", "ambiguous"] as const) {
    const ofClass = cases.filter((c) => classOf(c) === cls);
    if (ofClass.length === 0) continue;
    const passing = ofClass.filter((c) => rows.some((r) => r.tier === "B" && r.case === c.id && r.pass)).length;
    record({
      tier: "B",
      case: `class:${cls}`,
      expect: String(ofClass.length),
      actual: `${passing}/${ofClass.length}`,
      pass: passing === ofClass.length,
    });
  }
}

// ---------------------------------------------------------------------------
// Tier D — end-to-end on a read-only subset
// ---------------------------------------------------------------------------

/** Read-only cases only: no writes, no side effects on the user's data. */
const E2E_IDS = [
  "catalog:todos:list",
  "catalog:facts:list",
  "catalog:insights:list",
  "net:web_search",
  "auto:os_clipboard_get",
  "auto:os_system_status",
];

function e2eCases(): RouteCase[] {
  return E2E_IDS.map((id) => ROUTE_CASES.find((c) => c.id === id)).filter((c): c is RouteCase => c !== undefined);
}

async function tierD(): Promise<void> {
  process.env.QUEEN_TEMPERATURE = process.env.QUEEN_TEMPERATURE ?? "0";
  const cases = e2eCases();
  let index = 0;
  for (const c of cases) {
    index += 1;
    const passing = rows.filter((r) => r.tier === "D" && r.pass).length;
    log(`  [D ${index}/${cases.length}/${passing}] → ${c.prompt}`);
    const activity: AgentActivity[] = [];
    const model = new ElthurModel({ maxTokens: 512 });
    const bridge = recordingBridge();
    const orchestrator = createQueenAgent(model, bridge, activityLogger(activity));
    const routed: string[] = [];
    orchestrator.addHook(BeforeToolCallEvent, (event) => {
      routed.push(event.toolUse.name);
      log(`        route → ${event.toolUse.name}`);
    });

    const started = Date.now();
    let reply = "";
    const stop = heartbeat("model+runtime");
    try {
      const result = await orchestrator.invoke(withRouteHint(c.prompt));
      reply = messageText(result.lastMessage);
    } catch (e) {
      stop();
      record({ tier: "D", case: c.id, expect: `${c.agent} + ${c.tool ?? "*"}`, actual: `error: ${e instanceof Error ? e.message : e}`, pass: false });
      Bun.gc(true);
      continue;
    }
    stop();

    const workerTools = activity.filter((a) => a.kind === "tool").map((a) => (a as { name: string }).name);
    const agentOk = routedOk(c, routed);
    const toolOk = c.tool === undefined ? true : workerTools.includes(c.tool);
    const replyOk = reply.length > 0;
    const bridgeOk = c.agent !== "bee" || bridge.shown.length > 0 || bridge.refreshed > 0;
    record({
      tier: "D",
      case: c.id,
      expect: `${expectedLabel(c)} + ${c.tool ?? "*"}`,
      actual: `${routed[0] ?? "(none)"} + ${workerTools[0] ?? "(no worker tool)"}${c.agent === "bee" ? ` + panel:${bridge.shown.length}` : ""}`,
      pass: agentOk && toolOk && replyOk && bridgeOk,
      ttftMs: model.lastTtftMs,
      tokPerSec: model.lastTokPerSec,
      totalMs: Date.now() - started,
      reply,
      ...(replyOk ? {} : { note: "empty reply" }),
      ...(toolOk ? {} : { note: `wanted ${c.tool}` }),
    });
    Bun.gc(true); // one agent set per case; keep RSS flat
  }
}

// ---------------------------------------------------------------------------
// Tier C — live CRUD round-trip (creates and deletes only its own rows)
// ---------------------------------------------------------------------------

async function createFact(marker: string): Promise<number | string> {
  const created = mcpJson(await invokeBeeTool("bee_create_fact", { text: `Queen self-test ${marker}` }));
  const id = deepFindId(created) ?? deepFindId(mcpJson(await invokeBeeTool("bee_list_facts", { limit: 5, includeUnconfirmed: true })));
  if (id === undefined) throw new Error("could not find created fact id");
  return id;
}

async function factContains(id: number | string, needle: string): Promise<boolean> {
  return mcpText(await invokeBeeTool("bee_get_fact", { id })).includes(needle);
}

async function crudFact(): Promise<void> {
  const marker = `queen-selftest-${Date.now().toString(36)}`;
  let id: number | string | undefined;
  try {
    id = await createFact(marker);
    const found = await factContains(id, marker);
    record({ tier: "C", case: "fact create+read", expect: marker, actual: found ? "found" : "absent", pass: found });
    const updated = `${marker}-updated`;
    await invokeBeeTool("bee_update_fact", { id, text: `Queen self-test ${updated}` });
    const applied = await factContains(id, updated);
    record({ tier: "C", case: "fact update", expect: updated, actual: applied ? "applied" : "stale", pass: applied });
  } finally {
    if (id !== undefined) {
      await invokeBeeTool("bee_delete_fact", { id });
      const gone = !(await factContains(id, marker).catch(() => false));
      record({ tier: "C", case: "fact delete own row", expect: "gone", actual: gone ? "gone" : "still present", pass: gone });
    }
  }
}

async function crudTodo(): Promise<void> {
  const marker = `queen-selftest-${Date.now().toString(36)}`;
  let id: number | string | undefined;
  try {
    const created = mcpJson(await invokeBeeTool("bee_create_todo", { text: marker }));
    id = deepFindId(created);
    if (id === undefined) id = deepFindId(mcpJson(await invokeBeeTool("bee_list_todos", { limit: 10 })));
    if (id === undefined) throw new Error("could not find created todo id");
    const listed = mcpText(await invokeBeeTool("bee_list_todos", { limit: 25 })).includes(marker);
    record({ tier: "C", case: "todo create+list", expect: marker, actual: listed ? "found" : "absent", pass: listed });
    await invokeBeeTool("bee_update_todo", { id, completed: true });
    record({ tier: "C", case: "todo complete", expect: "ok", actual: "ok", pass: true });
  } finally {
    if (id !== undefined) {
      await invokeBeeTool("bee_delete_todo", { id });
      const gone = !mcpText(await invokeBeeTool("bee_list_todos", { limit: 25 })).includes(marker);
      record({ tier: "C", case: "todo delete own row", expect: "gone", actual: gone ? "gone" : "still present", pass: gone });
    }
  }
}

async function tierC(): Promise<void> {
  await crudFact();
  await crudTodo();
}

// ---------------------------------------------------------------------------
// Tier I — infra: the SSE watcher child connects and delivers a frame
// ---------------------------------------------------------------------------

async function tierI(): Promise<void> {
  const { startBeeWatch, stopBeeWatch, getBeeWatchState, subscribeBeeEvents } = await import(
    "../src/libraries/bee-watch"
  );
  const seen: string[] = [];
  const unsubscribe = subscribeBeeEvents((event) => seen.push(event.event));
  await startBeeWatch();
  // Wait up to ~10s for the first frame.
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await Bun.sleep(200);
  const state = getBeeWatchState();
  record({
    tier: "I",
    case: "bee-watch connects + first frame",
    expect: "connected + frame",
    actual: `${state.status}${seen[0] ? ` +${seen[0]}` : ""}${state.error ? ` (${state.error})` : ""}`,
    pass: state.status === "connected" && seen.length > 0,
  });
  unsubscribe();
  await stopBeeWatch();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`harness: tiers=${TIERS.join(",")} filter=${JSON.stringify(FILTER)} live=${LIVE} model=${process.env.ELTHUR_MODEL ?? "(unset)"}`);
  await ensureBeeMcp();
  log(`harness: bee mcp connected, ${beeToolNames().length} tools`);
  const loggedIn = await isLoggedIn();
  if (!loggedIn) log("harness: NOT logged in (tiers c/d need login)");

  if (TIERS.includes("a")) await tierA();
  if (TIERS.includes("b")) await tierB();
  if (TIERS.includes("d")) await tierD();
  if (TIERS.includes("c")) {
    if (!LIVE) log("  SKIP  [c] live CRUD (pass --live to run)");
    else if (!loggedIn) log("  SKIP  [c] live CRUD (not logged in)");
    else await tierC();
  }

  if (TIERS.includes("i")) {
    if (!loggedIn) log("  SKIP  [I] watcher (not logged in)");
    else await tierI();
  }

  await stopBeeMcp();

  const passed = rows.filter((r) => r.pass).length;
  log(`\nQUEEN HARNESS: ${passed}/${rows.length} passed`);
  await Bun.write(OUT, JSON.stringify({ tiers: TIERS, filter: FILTER, rows }, null, 2));
  log(`wrote ${OUT}`);
  if (rows.length - passed > 0) process.exitCode = 1;
}

await main();
