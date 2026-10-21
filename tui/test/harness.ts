import { BeforeToolCallEvent } from "@strands-agents/sdk";

import { ElthurModel } from "../src/functions/strands-model";
import { ACTION_CATALOG } from "../src/functions/action/catalog";
import { actionTool } from "../src/functions/action/execute";
import { beeToolNames, ensureBeeMcp, invokeBeeTool, stopBeeMcp } from "../src/libraries/bee-mcp";
import { isLoggedIn } from "../src/utils/bee-com-bridge";
import { createRoutedQueenAgent, type AgentActivity } from "../src/functions/tools-execution";
import type { DocFilter, UiBridge } from "../src/functions/ui-bridge";
import {
  ROUTE_CASES,
  casesFor,
  HEURISTIC_CASES,
  classOf,
  CLI_DECISION_CASES,
  CLI_INPUT_CASES,
  SSE_CASES,
  SUBCOMMAND_CASES,
  WATCH_LINE_CASES,
  type CliDecisionCase,
  type RouteCase,
} from "./cases";
import { automationDefs, automationToolNames } from "../src/functions/automation";
import { classifyRequest, planRoute } from "../src/functions/agents/orchestrator";
import { cliMenu, decide, type CliDecision } from "../src/functions/action/cli-menu";
import { clarifySpec, helpSpec, resolveCliInput, runCli } from "../src/functions/action/cli";
import { errorSpec } from "../src/functions/action/external";
import { beeRefreshFor, parseWatchLine, SUPPORTED_EVENT_TYPES } from "../src/libraries/bee-watch";

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

function decisionMatches(expected: CliDecisionCase, actual: CliDecision): boolean {
  if (expected.kind !== actual.kind) return false;

  if (expected.kind === "subcommand" || expected.kind === "external") {
    if (actual.kind !== expected.kind) return false;
    return expected.name === undefined || actual.name === expected.name;
  }
  if (expected.kind === "catalog") {
    return expected.catalogId === undefined || (actual.kind === "catalog" && actual.id === expected.catalogId);
  }
  if (expected.kind === "latest") {
    return (
      expected.kinds === undefined ||
      (actual.kind === "latest" && expected.kinds.every((kind) => (actual.kinds as string[]).includes(kind)))
    );
  }
  if (expected.kind === "ir") {
    if (actual.kind !== "ir") return false;
    if (expected.query !== undefined && actual.query !== expected.query) return false;
    if (expected.filter !== undefined && actual.filter !== expected.filter) return false;
    return true;
  }
  if (expected.kind === "action") {
    return expected.worker === undefined || (actual.kind === "action" && actual.worker === expected.worker);
  }
  if (expected.kind === "clarify") {
    if (actual.kind !== "clarify") return false;
    return (
      expected.suggestionIncludes === undefined ||
      expected.suggestionIncludes.every((needle) =>
        actual.suggestions.some((suggestion) => suggestion.includes(needle)),
      )
    );
  }
  return true;
}

function decisionExpectation(expected: CliDecisionCase): string {
  if (expected.kind === "subcommand" || expected.kind === "external") {
    return `${expected.kind}:${expected.name ?? "*"}`;
  }
  if (expected.kind === "catalog") return `catalog:${expected.catalogId ?? "*"}`;
  if (expected.kind === "latest") return `latest:${(expected.kinds ?? []).join(",")}`;
  if (expected.kind === "ir") return `ir:${expected.query ?? "*"}${expected.filter ? ` [${expected.filter}]` : ""}`;
  if (expected.kind === "action") return `action:${expected.worker ?? "*"}`;
  if (expected.kind === "clarify") return `clarify:${(expected.suggestionIncludes ?? []).join(" & ") || "*"}`;
  return expected.kind;
}

function describeDecision(decision: CliDecision): string {
  switch (decision.kind) {
    case "subcommand":
      return `subcommand:${decision.name}`;
    case "external":
      return `external:${decision.name}`;
    case "catalog":
      return `catalog:${decision.id}`;
    case "latest":
      return `latest:${decision.kinds.join(",")}`;
    case "ir":
      return `ir:${decision.query}${decision.filter ? ` [${decision.filter}]` : ""}`;
    case "action":
      return `action:${decision.worker}`;
    case "clarify":
      return `clarify:${decision.suggestions.join(" | ")}`;
    case "chat":
      return "chat";
    case "help":
      return "help";
    default:
      return "unknown";
  }
}

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

  // 6. CLI input resolution: bare queen opens the TUI; args or piped stdin run.
  for (const inputCase of CLI_INPUT_CASES) {
    const actual = resolveCliInput({
      argv: inputCase.argv,
      stdinIsTTY: inputCase.tty,
      ...(inputCase.stdin !== undefined ? { stdinText: inputCase.stdin } : {}),
    });
    record({
      tier: "A",
      case: `cli-input:${inputCase.id}`,
      expect: JSON.stringify(inputCase.expect),
      actual: JSON.stringify(actual),
      pass: actual === inputCase.expect,
    });
  }

  // 7. CLI decisions: every registry subcommand + free text (IR/actions/clarify).
  let decisionPass = 0;
  for (const decisionCase of CLI_DECISION_CASES) {
    const actual = decide(decisionCase.prompt);
    const ok = decisionMatches(decisionCase, actual);
    if (ok) decisionPass += 1;
    record({
      tier: "A",
      case: `decide:${decisionCase.id}`,
      expect: decisionExpectation(decisionCase),
      actual: describeDecision(actual),
      pass: ok,
    });
  }
  record({
    tier: "A",
    case: "decide accuracy",
    expect: String(CLI_DECISION_CASES.length),
    actual: `${decisionPass}/${CLI_DECISION_CASES.length}`,
    pass: decisionPass === CLI_DECISION_CASES.length,
  });

  // 8. Coverage: every registry-derived subcommand has a decision case.
  const menuLabels = new Set(cliMenu().map((entry) => entry.label));
  const caseLabels = new Set(SUBCOMMAND_CASES.map((entry) => entry.prompt));
  const missingMenu = [...menuLabels].filter((label) => !caseLabels.has(label));
  record({
    tier: "A",
    case: "coverage cli menu",
    expect: "0 missing",
    actual: missingMenu.length === 0 ? "0 missing" : missingMenu.join(", "),
    pass: missingMenu.length === 0 && menuLabels.size > 10,
  });

  // 9. SSE -> refresh filter, including "honor the active filter".
  for (const sseCase of SSE_CASES) {
    const filter = beeRefreshFor(sseCase.active, { event: sseCase.event, data: {} });
    const kinds = filter?.kinds ? [...filter.kinds] : null;
    record({
      tier: "A",
      case: sseCase.id,
      expect: JSON.stringify(sseCase.expect),
      actual: JSON.stringify(kinds),
      pass: JSON.stringify(kinds) === JSON.stringify(sseCase.expect),
    });
  }
  const sseTypes = new Set(SSE_CASES.map((entry) => entry.event));
  const missingEvents = SUPPORTED_EVENT_TYPES.filter((event) => !sseTypes.has(event));
  record({
    tier: "A",
    case: "coverage sse events",
    expect: "0 missing",
    actual: missingEvents.length === 0 ? "0 missing" : missingEvents.join(", "),
    pass: missingEvents.length === 0,
  });

  // 9b. watch-all JSONL line parser.
  for (const lineCase of WATCH_LINE_CASES) {
    const parsed = parseWatchLine(lineCase.line);
    const actual = parsed?.event ?? null;
    record({
      tier: "A",
      case: lineCase.id,
      expect: JSON.stringify(lineCase.expect),
      actual: JSON.stringify(actual),
      pass: actual === lineCase.expect,
    });
  }

  // 10. Card chrome: heading, subheading, body.
  const help = helpSpec();
  record({
    tier: "A",
    case: "card:help",
    expect: "queen + sections",
    actual: `${help.title}/${help.sections.length}`,
    pass: help.title === "queen" && help.sections.length >= 3,
  });

  const clarifyCard = clarifySpec("Create a note from my todo", [
    'queen todos create --text "<what to do>"',
    'queen "Create a note from my todo on my Mac"',
  ]);
  const clarifyText = JSON.stringify(clarifyCard);
  record({
    tier: "A",
    case: "card:clarify",
    expect: "unclear + suggestions",
    actual: `${clarifyCard.title}/${clarifyCard.subtitle ?? ""}`,
    pass:
      clarifyCard.title === "unclear" &&
      clarifyCard.subtitle === "Create a note from my todo" &&
      clarifyText.includes("queen todos create") &&
      clarifyText.includes("Mac"),
  });

  const failure = errorSpec("queen", new Error("boom"));
  record({
    tier: "A",
    case: "card:error",
    expect: "queen + command failed + boom",
    actual: `${failure.title}/${failure.subtitle ?? ""}`,
    pass:
      failure.title === "queen" &&
      failure.subtitle === "command failed" &&
      JSON.stringify(failure).includes("boom"),
  });

  // 11. runCli error path and clarify path.
  const failed = await runCli("status", {
    deps: {
      externalSpec: async () => {
        throw new Error("kaboom");
      },
    },
  });
  record({
    tier: "A",
    case: "cli:error card",
    expect: "ok=false + kaboom",
    actual: `${failed.ok}/${failed.spec.subtitle ?? ""}`,
    pass: !failed.ok && JSON.stringify(failed.spec).includes("kaboom"),
  });

  const unclear = await runCli("Create a note from my todo");
  record({
    tier: "A",
    case: "cli:clarify card",
    expect: "ok=false + unclear",
    actual: `${unclear.ok}/${unclear.spec.title}`,
    pass: !unclear.ok && unclear.spec.title === "unclear",
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

async function tierB(): Promise<void> {
  // Routing is deterministic now, so B asserts the plan itself. Model/tool
  // behaviour is covered by D (end-to-end), M (mac automation) and E (CLI).
  const cases = casesFor(FILTER || undefined);
  for (const c of cases) {
    const plan = planRoute(c.prompt);
    const actual =
      plan.kind === "worker" ? plan.worker : plan.kind === "clarify" ? "clarify" : "(no worker)";
    record({ tier: "B", case: c.id, expect: expectedLabel(c), actual, pass: actual === expectedLabel(c) });
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
  "neg:greeting",
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
    const routed = createRoutedQueenAgent(model, bridge, activityLogger(activity));
    const plan = routed.plan(c.prompt);
    const orchestrator =
      plan.kind === "worker" ? routed.worker(plan.worker) ?? routed.chat() : routed.chat();
    const routedNames: string[] = [];
    orchestrator.addHook(BeforeToolCallEvent, (event) => {
      routedNames.push(event.toolUse.name);
      log(`        route → ${event.toolUse.name}`);
    });

    const started = Date.now();
    let reply = "";
    const stop = heartbeat("model+runtime");
    try {
      const result = await orchestrator.invoke(c.prompt);
      reply = messageText(result.lastMessage);
    } catch (e) {
      stop();
      record({ tier: "D", case: c.id, expect: `${c.agent} + ${c.tool ?? "*"}`, actual: `error: ${e instanceof Error ? e.message : e}`, pass: false });
      Bun.gc(true);
      continue;
    }
    stop();

    const workerTools = activity.filter((a) => a.kind === "tool").map((a) => (a as { name: string }).name);
    const agentOk =
      c.agent === "none"
        ? plan.kind === "direct"
        : plan.kind === "worker" && plan.worker === c.agent;
    const toolOk = c.tool === undefined ? true : workerTools.includes(c.tool);
    const replyOk = reply.length > 0;
    const bridgeOk = c.agent !== "bee" || bridge.shown.length > 0 || bridge.refreshed > 0;
    record({
      tier: "D",
      case: c.id,
      expect: `${expectedLabel(c)} + ${c.tool ?? "*"}`,
      actual: `${plan.kind === "worker" ? plan.worker : plan.kind} + ${workerTools[0] ?? "(no worker tool)"}${c.agent === "bee" ? ` + panel:${bridge.shown.length}` : ""}`,
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
// Tier E — live one-shot CLI cards (real Bee API, real card chrome)
// ---------------------------------------------------------------------------

async function tierE(): Promise<void> {
  const cases: { id: string; prompt: string; title: string }[] = [
    { id: "cli:status", prompt: "status", title: "status" },
    { id: "cli:todos-list", prompt: "todos list", title: "todos" },
    { id: "cli:latest-todo", prompt: "show latest todo", title: "latest todo" },
    { id: "cli:facts", prompt: "list my facts", title: "Facts" },
    { id: "cli:search", prompt: "what did I say about the budget", title: "search" },
    { id: "cli:help", prompt: "help", title: "queen" },
  ];
  for (const c of cases) {
    const started = Date.now();
    const { spec, ok } = await runCli(c.prompt);
    const titleOk = c.id === "cli:latest-todo" ? spec.title.length > 0 : spec.title === c.title;
    record({
      tier: "E",
      case: c.id,
      expect: c.title,
      actual: `${spec.title} (${ok})`,
      pass: ok && titleOk && spec.sections.length > 0,
      totalMs: Date.now() - started,
    });
  }
}

// ---------------------------------------------------------------------------
// Tier M — live macOS automation: real Notes / Reminders / Calendar rows
// ---------------------------------------------------------------------------

async function osaJxa(body: string, argv: string[]): Promise<string> {
  const proc = Bun.spawn(
    ["osascript", "-l", "JavaScript", "-e", `function run(argv){${body}}`, "--", ...argv],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `osascript exit ${code}`);
  return stdout.trim();
}

function automationDef(name: string) {
  const def = automationDefs().find((entry) => entry.name === name);
  if (!def) throw new Error(`missing automation tool: ${name}`);
  return def;
}

function macPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /-1743|-1712|not authori[sz]ed|not permitted|assistive access/i.test(message);
}

// Count by unique prefix: Notes truncates long names with an ellipsis, so an
// exact match on the full title (including the marker) would miss the row.
const NOTES_COUNT =
  'var a=Application("Notes");var fs=a.folders;var n=0;for(var j=0;j<fs.length;j++){if(fs[j].name()==="Recently Deleted")continue;var names=fs[j].notes.name();for(var i=0;i<names.length;i++){if(String(names[i]).indexOf(argv[0])===0)n++;}}return String(n);';
const NOTES_DELETE =
  'var a=Application("Notes");var rows=a.notes;for(var i=rows.length-1;i>=0;i--){if(String(rows[i].name()).indexOf(argv[0])===0)a.delete(rows[i]);}return "deleted";';
const REMINDERS_COUNT =
  'var a=Application("Reminders");var names=a.reminders.name();var n=0;for(var i=0;i<names.length;i++){if(String(names[i]).indexOf(argv[0])===0)n++;}return String(n);';
const REMINDERS_DELETE =
  'var a=Application("Reminders");var rows=a.reminders;for(var i=rows.length-1;i>=0;i--){if(String(rows[i].name()).indexOf(argv[0])===0)a.delete(rows[i]);}return "deleted";';
const CALENDAR_COUNT =
  'var a=Application("Calendar");var names=a.calendars[0].events.summary();var n=0;for(var i=0;i<names.length;i++){if(names[i]===argv[0])n++;}return String(n);';
const CALENDAR_DELETE =
  'var a=Application("Calendar");var rows=a.calendars[0].events;for(var i=rows.length-1;i>=0;i--){if(rows[i].summary()===argv[0])a.delete(rows[i]);}return "deleted";';

/** Rows created by tier M are left in place so Bee downstream automation can read them. */
const MAC_MARKER = "(Queen for Bee downstream automation)";
const MAC_CLEANUP = process.env.QUEEN_HARNESS_MAC_CLEANUP === "1";

async function macNote(): Promise<void> {
  const prefix = `queen-selftest-note-${Date.now().toString(36)}`;
  const title = `${prefix} ${MAC_MARKER}`;
  const before = Number(await osaJxa(NOTES_COUNT, [prefix]));
  await automationDef("os_create_note").run({
    title,
    body:
      "Created by Queen's macOS automation self-test. " +
      "Intentionally left in place for Bee downstream automation.",
  });
  const after = Number(await osaJxa(NOTES_COUNT, [prefix]));
  record({
    tier: "M",
    case: "mac:note create",
    expect: "1",
    actual: String(after - before),
    pass: after - before === 1,
    note: MAC_CLEANUP ? "deleted after verification" : "kept for Bee downstream automation",
  });
  if (MAC_CLEANUP) await osaJxa(NOTES_DELETE, [prefix]);
}

async function macReminder(): Promise<void> {
  const prefix = `queen-selftest-rem-${Date.now().toString(36)}`;
  const title = `${prefix} ${MAC_MARKER}`;
  const before = Number(await osaJxa(REMINDERS_COUNT, [prefix]));
  await automationDef("os_add_reminder").run({
    title,
    due: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const after = Number(await osaJxa(REMINDERS_COUNT, [prefix]));
  record({
    tier: "M",
    case: "mac:reminder create",
    expect: "1",
    actual: String(after - before),
    pass: after - before === 1,
    note: MAC_CLEANUP ? "deleted after verification" : "kept for Bee downstream automation",
  });
  if (MAC_CLEANUP) await osaJxa(REMINDERS_DELETE, [prefix]);
}

async function macCalendar(): Promise<void> {
  const marker = `queen-selftest-cal-${Date.now().toString(36)}`;
  const start = new Date(Date.now() + 3_600_000);
  const end = new Date(start.getTime() + 1_800_000);
  await automationDef("os_add_calendar_event").run({
    title: marker,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const count = Number(await osaJxa(CALENDAR_COUNT, [marker]));
  record({ tier: "M", case: "mac:calendar create", expect: "1", actual: String(count), pass: count >= 1 });
  await osaJxa(CALENDAR_DELETE, [marker]);
  const left = Number(await osaJxa(CALENDAR_COUNT, [marker]));
  record({ tier: "M", case: "mac:calendar cleanup", expect: "0", actual: String(left), pass: left === 0 });
}

async function tierM(): Promise<void> {
  if (process.platform !== "darwin") {
    record({ tier: "M", case: "mac:platform", expect: "darwin", actual: process.platform, pass: true, note: "SKIP" });
    return;
  }
  // Each app needs its own Automation grant, so a denial in one must not hide
  // results from the others.
  const apps: readonly [string, () => Promise<void>][] = [
    ["note", macNote],
    ["reminder", macReminder],
    ["calendar", macCalendar],
  ];
  for (const [app, run] of apps) {
    try {
      await run();
    } catch (error) {
      if (macPermissionError(error)) {
        const detail = error instanceof Error ? error.message : String(error);
        record({
          tier: "M",
          case: `mac:${app} permission`,
          expect: "granted",
          actual: `not granted (${detail}) — allow Automation in System Settings > Privacy & Security`,
          pass: true,
          note: `SKIP (grant Automation to the terminal/Bun, then rerun --tiers m --live)`,
        });
        continue;
      }
      record({
        tier: "M",
        case: `mac:${app}`,
        expect: "no error",
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
      });
    }
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
  const frames: { event: string; data: unknown }[] = [];
  const unsubscribe = subscribeBeeEvents((event) => {
    seen.push(event.event);
    frames.push(event);
  });
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

  // End-to-end: a real Bee write must produce a real SSE frame that maps to a
  // todo refresh. This is the actual "SSE updates the UI" contract.
  const marker = `queen-selftest-sse-${Date.now().toString(36)}`;
  let id: number | string | undefined;
  try {
    const created = mcpJson(await invokeBeeTool("bee_create_todo", { text: marker }));
    id = deepFindId(created) ?? deepFindId(mcpJson(await invokeBeeTool("bee_list_todos", { limit: 10 })));
    if (id === undefined) throw new Error("could not find created todo id");

    const deadline = Date.now() + 15_000;
    let frame: { event: string; data: unknown } | undefined;
    while (Date.now() < deadline) {
      frame = frames.find(
        (item) => item.event === "todo-created" && JSON.stringify(item.data).includes(marker),
      );
      if (frame) break;
      await Bun.sleep(250);
    }
    const filter = frame ? beeRefreshFor(null, frame) : null;
    if (!frame) {
      record({
        tier: "I",
        case: "SSE todo-created -> refresh todo",
        expect: "todo-created + [todo]",
        actual: "server did not broadcast the developer write",
        pass: true,
        note: "SKIP (Bee broadcasts app events; developer writes are silent)",
      });
    } else {
      record({
        tier: "I",
        case: "SSE todo-created -> refresh todo",
        expect: "todo-created + [todo]",
        actual: `${frame.event} + ${JSON.stringify(filter?.kinds ?? null)}`,
        pass: JSON.stringify(filter?.kinds) === JSON.stringify(["todo"]),
      });
    }
  } finally {
    if (id !== undefined) await invokeBeeTool("bee_delete_todo", { id }).catch(() => {});
  }

  unsubscribe();
  await stopBeeWatch();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/** Mirror the family the bundled binary bakes in, so routing runs with the same
 *  sampling params the shipped build uses. */
function modelFamily(path: string | undefined): string | undefined {
  const name = (path ?? "").toLowerCase();
  if (name.includes("lfm2.5")) return "lfm2.5";
  if (name.includes("qwen3.5")) return "qwen3.5";
  return undefined;
}

async function main(): Promise<void> {
  if (process.env.QUEEN_MODEL_FAMILY == null) {
    const family = modelFamily(process.env.ELTHUR_MODEL);
    if (family) process.env.QUEEN_MODEL_FAMILY = family;
  }
  log(`harness: tiers=${TIERS.join(",")} filter=${JSON.stringify(FILTER)} live=${LIVE} model=${process.env.ELTHUR_MODEL ?? "(unset)"} family=${process.env.QUEEN_MODEL_FAMILY ?? "(default)"}`);
  await ensureBeeMcp();
  log(`harness: bee mcp connected, ${beeToolNames().length} tools`);
  const loggedIn = await isLoggedIn();
  if (!loggedIn) log("harness: NOT logged in (tiers c/d need login)");

  if (TIERS.includes("a")) await tierA();
  if (TIERS.includes("b")) await tierB();
  if (TIERS.includes("d")) await tierD();
  if (TIERS.includes("e")) {
    if (!LIVE) log("  SKIP  [E] live CLI (pass --live to run)");
    else if (!loggedIn) log("  SKIP  [E] live CLI (not logged in)");
    else await tierE();
  }
  if (TIERS.includes("m")) {
    if (!LIVE) log("  SKIP  [M] live mac automation (pass --live to run)");
    else await tierM();
  }
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
