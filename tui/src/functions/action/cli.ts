import { homedir } from "node:os";
import { join } from "node:path";

import { callBeeTextTool } from "@/commands/mcpToolOutput";

import { conversationDocument, loadRecentDocuments, type DocumentKind } from "../../documents";
import { loadConfig } from "../../documents/config";
import { withInferredSpeakers } from "../../utils/diarize-speaker";
import { relevanceScores } from "../analytics/relevance";
import type { CardAlign, CardSection, CardSpec } from "../../interface/scrollback-card";
import { beeContext, buildTable, captureConsole, humanDate } from "../../utils/bee-com-bridge";
import { ACTION_CATALOG } from "./catalog";
import { AgentRunner } from "../agents/runner";
import { beeUri } from "../agents/format";
import { LANE_LABELS } from "../agents/lanes";
import type { StatusListener } from "../agents/types";
import {
  EXTRA_COMMANDS,
  cliMenu,
  decide,
  type CliDecision,
  type CliWorker,
  type SearchFilter,
} from "./cli-menu";
import { executeAction, type ActionOutcome } from "./execute";
import { errorSpec, externalSpec } from "./external";

export type CliEmit = (spec: CardSpec) => Promise<void>;

export type ThinkingListener = (text: string) => void;

export type CliDeps = {
  subcommandSpec?: (name: string, argv: string[], options?: { json?: boolean }) => Promise<CardSpec>;
  externalSpec?: (name: string, argv: string[], emit?: CliEmit) => Promise<CardSpec>;
  catalogSpec?: (id: string) => Promise<CardSpec>;
  latestSpec?: (kinds: DocumentKind[]) => Promise<CardSpec>;
  irSpec?: (query: string, filter?: SearchFilter) => Promise<CardSpec>;
  agentSpec?: (prompt: string, onThinking?: ThinkingListener, onStatus?: StatusListener) => Promise<CardSpec>;
  uriSpec?: (uri: string, options?: { json?: boolean }) => Promise<CardSpec>;
};

export type CliOptions = {
  emit?: CliEmit;
  deps?: CliDeps;
  json?: boolean;
  argv?: readonly string[];
  onThinking?: ThinkingListener;
  onStatus?: StatusListener;
};

export type CliResult = {
  spec: CardSpec;
  ok: boolean;
  kind: CliDecision["kind"];
  command: string;
  elapsedMs: number;
  json: boolean;
  data: unknown;
  error?: string;
};

export type CliJson = {
  ok: boolean;
  kind: CliDecision["kind"];
  command: string;
  elapsedMs: number;
  error?: string;
  data: unknown;
};

export function resolveCliInput(input: {
  argv: readonly string[];
  stdinIsTTY: boolean;
  stdinText?: string;
}): string | null {
  const fromArgs = input.argv.join(" ").trim();
  if (fromArgs.length > 0) return fromArgs;
  const fromStdin = (input.stdinText ?? "").trim();
  if (!input.stdinIsTTY && fromStdin.length > 0) return fromStdin;
  return null;
}

export function parseCliFlags(argv: readonly string[]): { argv: string[]; json: boolean } {
  return { argv: argv.filter((arg) => arg !== "--json"), json: argv.includes("--json") };
}


function shortDescription(text: string, max = 88): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=\.)\s/, 1)[0] ?? clean;
  return first.length > max ? `${first.slice(0, max - 3).trimEnd()}...` : first;
}

export function helpSpec(): CardSpec {
  const entries = cliMenu();
  const commands = [
    ...entries.map((entry) => ({ command: entry.label, description: entry.description })),
    ...EXTRA_COMMANDS.map((entry) => ({ command: entry.name, description: entry.description })),
  ];
  const rows: (string | number)[][] = commands.map((entry) => [
    entry.command,
    shortDescription(entry.description),
  ]);
  return {
    title: "queen",
    subtitle: "one-shot CLI",
    sections: [
      {
        kind: "text",
        text: "queen <command> runs one action and exits. Bare `queen` opens the TUI.",
      },
      { kind: "table", columns: ["command", "description"], rows },
      {
        kind: "text",
        text: [
          "examples:",
          '  queen todos create --text "buy milk"',
          "  queen show latest todo",
          '  queen "what did I say about the budget" | cat',
          "  queen status --json | jq .data",
          "  queen bee://conversations/10414635",
        ].join("\n"),
      },
    ],
    data: { commands },
  };
}

export function clarifySpec(prompt: string, suggestions: string[]): CardSpec {
  return {
    title: "unclear",
    subtitle: prompt,
    sections: [
      { kind: "text", text: "Did you mean:" },
      { kind: "text", text: suggestions.map((suggestion) => `  ${suggestion}`).join("\n") },
      { kind: "text", text: "Run one of these, or run `queen` for the TUI." },
    ],
    data: { prompt, suggestions },
  };
}

function sectionForTable(table: {
  columns: string[];
  rows: (string | number)[][];
  aligns?: CardAlign[];
}): CardSection {
  return {
    kind: "table",
    columns: table.columns,
    rows: table.rows,
    ...(table.aligns ? { aligns: table.aligns } : {}),
  };
}

function outcomeSpec(title: string, outcome: ActionOutcome): CardSpec {
  if (outcome.view?.table) {
    return {
      title: outcome.view.title || title,
      sections: [sectionForTable(outcome.view.table)],
      data: outcome.view.table,
    };
  }
  if (outcome.markdown) {
    return {
      title,
      sections: [{ kind: "markdown", content: outcome.markdown }],
      data: outcome.markdown,
    };
  }
  return { title, sections: [{ kind: "text", text: "done" }], data: { done: true } };
}

async function conversationSpec(argv: string[]): Promise<CardSpec> {
  const subcommand = argv[0] ?? "get";
  const id = argv[1];
  if (id === undefined || id.length === 0) throw new Error("Missing conversation id.");

  const ctx = await beeContext("prod");
  const numeric = Number(id);
  const toolId = Number.isFinite(numeric) ? numeric : id;

  if (subcommand === "transcript") {
    const sinceIndex = argv.indexOf("--since");
    const sinceValue = sinceIndex >= 0 ? argv[sinceIndex + 1] : undefined;
    if (sinceIndex >= 0 && (sinceValue === undefined || !Number.isFinite(Number(sinceValue)))) {
      throw new Error("--since must be a valid epoch timestamp");
    }
    const raw = await callBeeTextTool(ctx, "bee_get_conversation_transcript", {
      id: toolId,
      ...(sinceValue !== undefined ? { since: Number(sinceValue) } : {}),
    });
    const annotated = withInferredSpeakers(raw);
    const data =
      annotated && typeof annotated === "object" && !Array.isArray(annotated)
        ? (annotated as Record<string, unknown>)
        : {};
    const transcript = Array.isArray(data["transcript"]) ? data["transcript"] : [];
    const doc = conversationDocument(id, {
      conversation: { transcriptions: [{ utterances: transcript }] },
      ...(typeof data["timezone"] === "string" ? { timezone: data["timezone"] } : {}),
    });
    return {
      title: "conversations",
      subtitle: argv.join(" "),
      sections: [{ kind: "markdown", content: doc.transcript || "_No transcript captured._" }],
      data: annotated,
    };
  }

  const raw = await callBeeTextTool(ctx, "bee_get_conversation", {
    id: toolId,
    includeTranscript: true,
  });
  const annotated = withInferredSpeakers(raw);
  const doc = conversationDocument(id, annotated);
  return {
    title: "conversations",
    subtitle: argv.join(" "),
    sections: [{ kind: "markdown", content: doc.markdown }],
    data: annotated,
  };
}

export async function subcommandSpec(
  name: string,
  argv: string[],
  options: { json?: boolean } = {},
): Promise<CardSpec> {
  if (name === "conversations" && (argv[0] === "get" || argv[0] === "transcript")) {
    return conversationSpec(argv);
  }

  const [{ resourceCommand }, ctx] = await Promise.all([import("@/commands/registry"), beeContext("prod")]);
  const command = resourceCommand(name);

  // Search always runs through the JSON surface internally so we can score and
  // sort results ourselves; the rendered card and the `--json` payload are the
  // same scored data.
  if (name === "search") {
    const config = loadConfig();
    const wantsNeural = argv.includes("--neural");
    const wantsKeyword = argv.includes("--keyword");
    const keywordOnly = ["--filter", "--scope", "--sort", "--sortBy"].some((flag) =>
      argv.includes(flag),
    );
    const searchArgv = argv.filter((arg) => arg !== "--keyword");
    if (!wantsNeural && !wantsKeyword && !keywordOnly && config.searchMode === "neural") {
      searchArgv.push("--neural");
    }

    const text = await captureConsole(() =>
      command.run(searchArgv.includes("--json") ? searchArgv : [...searchArgv, "--json"], ctx),
    );
    const data = parseJsonText(text);
    if (data === undefined) {
      return {
        title: name,
        subtitle: argv.join(" "),
        sections: [{ kind: "markdown", content: text.length > 0 ? text : "done" }],
      };
    }
    const query = searchQueryArg(searchArgv);
    const spec = searchSpec(query, data);
    return { ...spec, subtitle: query.length > 0 ? query : command.description };
  }

  const args = options.json && !argv.includes("--json") ? [...argv, "--json"] : argv;
  const text = await captureConsole(() => command.run(args, ctx));
  const data = options.json ? parseJsonText(text) : undefined;
  return {
    title: name,
    subtitle: argv.length > 0 ? argv.join(" ") : command.description,
    sections: [{ kind: "markdown", content: text.length > 0 ? text : "done" }],
    ...(data !== undefined ? { data } : {}),
  };
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const BEE_URI_TYPES = new Map<string, string>([
  ["conversation", "conversations"],
  ["conversations", "conversations"],
  ["daily", "daily"],
  ["daily-summary", "daily"],
  ["daily-summaries", "daily"],
  ["fact", "facts"],
  ["facts", "facts"],
  ["insight", "insights"],
  ["insights", "insights"],
  ["journal", "journals"],
  ["journals", "journals"],
  ["voice-note", "journals"],
  ["voice-notes", "journals"],
  ["todo", "todos"],
  ["todos", "todos"],
  ["task", "todos"],
  ["tasks", "todos"],
  ["photo", "photos"],
  ["photos", "photos"],
]);

const BEE_URI_SUPPORTED =
  "conversations, daily, facts, insights, journals, todos, photos";

function beeUriTarget(uri: string): { resource: string; argv: string[] } {
  const match = /^bee:\/\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(uri.trim());
  if (!match) {
    throw new Error(
      `Invalid Bee URI: ${uri}\nExpected: bee://<type>/<id>\nSupported: ${BEE_URI_SUPPORTED}`,
    );
  }
  let type: string;
  let id: string;
  try {
    type = decodeURIComponent(match[1] ?? "").toLowerCase();
    id = decodeURIComponent(match[2] ?? "");
  } catch {
    throw new Error(`Invalid Bee URI encoding: ${uri}`);
  }
  const resource = BEE_URI_TYPES.get(type);
  if (!resource) {
    throw new Error(`Unsupported Bee URI: ${uri}\nSupported: ${BEE_URI_SUPPORTED}`);
  }
  if (id.length === 0) {
    throw new Error(`Missing id in Bee URI: ${uri}`);
  }
  if (resource === "photos") {
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
    const output = join(homedir(), ".bee", "photos", safeId);
    return { resource, argv: ["get", id, "--output", output] };
  }
  return { resource, argv: ["get", id] };
}

export async function uriSpec(
  uri: string,
  options: { json?: boolean } = {},
): Promise<CardSpec> {
  const target = beeUriTarget(uri);
  const spec = await subcommandSpec(target.resource, target.argv, options);
  return { ...spec, subtitle: uri };
}

export async function catalogSpec(id: string): Promise<CardSpec> {
  const action = ACTION_CATALOG.find((entry) => entry.id === id);
  if (!action) throw new Error(`Unknown action: ${id}`);
  return outcomeSpec(action.label, await executeAction(action, undefined));
}

export async function latestSpec(kinds: DocumentKind[]): Promise<CardSpec> {
  const docs = await loadRecentDocuments({ kinds, limit: 1, sort: "recency" });
  const doc = docs[0];
  if (!doc) {
    return {
      title: `latest ${kinds[0] ?? "item"}`,
      subtitle: "nothing yet",
      sections: [{ kind: "text", text: "Bee hasn't captured one yet." }],
      data: { item: null },
    };
  }
  return {
    title: doc.title,
    subtitle: doc.subtitle,
    sections: [{ kind: "markdown", content: doc.body || doc.markdown }],
    data: doc,
  };
}

export async function irSpec(query: string, filter?: SearchFilter): Promise<CardSpec> {
  const ctx = await beeContext("prod");
  const config = loadConfig();
  const filtered = filter !== undefined && filter !== "all";
  const mode = filtered || config.searchMode === "keyword" ? "keyword" : "semantic";
  const data = await callBeeTextTool(ctx, "bee_search", {
    query,
    mode,
    limit: 20,
    ...(mode === "keyword" && filtered ? { filter } : {}),
  });
  return searchSpec(query, data);
}

/** Build a search card from a raw Bee payload, ranking results by relevance. */
function searchSpec(query: string, data: unknown): CardSpec {
  const ranked = scoreSearchResults(query, data);
  const body = ranked?.payload ?? data;
  let section: CardSection | undefined = ranked?.section;
  if (ranked) {
    section ??= { kind: "text", text: "No relevant results." };
  } else {
    const table = buildTable(data);
    if (table) section = sectionForTable(table);
  }
  if (section) {
    return { title: "search", subtitle: query, sections: [section], data: body };
  }
  return {
    title: "search",
    subtitle: query,
    sections: [
      {
        kind: "markdown",
        content: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    data: body,
  };
}

function cleanSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^#{1,6}\s*Summary\s*/i, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `--query` value from normalized search argv, or "" when absent. */
function searchQueryArg(argv: readonly string[]): string {
  const index = argv.indexOf("--query");
  return index >= 0 ? (argv[index + 1] ?? "") : "";
}

/** Harmonic mean, 0 when either input is 0 (or negative). */
function harmonicMean(a: number, b: number): number {
  return a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0;
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type SearchRow = {
  entry: Record<string, unknown>;
  index: number;
  when: string;
  summary: string;
  score?: number;
  combined: number;
};

/**
 * Score every result against the query, then combine that with the server BM25
 * `score` when present (harmonic mean; BM25 is unbounded, so it is min-max
 * normalized across the page first). Results rank by the combined value, ties
 * keep API order, and the payload preserves the original response while adding
 * `query` plus a per-result `relevance`. The card keeps the top 10 non-blank
 * summaries; the payload keeps every result.
 */
function scoreSearchResults(
  query: string,
  data: unknown,
): { section?: CardSection; payload: unknown } | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const results = record["results"];
  if (!Array.isArray(results)) return undefined;
  if (results.length === 0) {
    return { payload: { ...record, query, results: [] } };
  }

  const rows: SearchRow[] = results.map((item, index) => {
    const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      entry,
      index,
      when: humanDate(
        entry["started_at"] ?? entry["created_at"] ?? entry["date_time"] ?? entry["date"],
      ),
      summary: cleanSummary(
        entry["detailed_summary"] ?? entry["summary"] ?? entry["short_summary"] ?? entry["text"],
      ),
      score: finiteScore(entry["score"]),
      combined: 0,
    };
  });

  const relevance = relevanceScores(query, rows.map((row) => row.summary));
  const values = rows
    .map((row) => row.score)
    .filter((value): value is number => value !== undefined);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;

  const ranked = rows.map((row) => {
    const rel = relevance[row.index] ?? 0;
    const normalized =
      row.score === undefined
        ? undefined
        : max > min
          ? (row.score - min) / (max - min)
          : row.score > 0
            ? 1
            : 0;
    const combined = normalized === undefined ? rel : harmonicMean(normalized, rel);
    return { ...row, combined };
  });

  ranked.sort((a, b) => b.combined - a.combined || a.index - b.index);

  // Anything that would display as 0% is noise; drop it from both the card and
  // the machine-readable payload.
  const matched = ranked.filter((row) => Math.round(row.combined * 100) > 0);

  const showRelevance = loadConfig().showRelevanceScores;
  const cardRows = matched
    .filter((row) => row.summary.length > 0)
    .map((row) => {
      const kind = typeof row.entry["type"] === "string" ? row.entry["type"] : "conversation";
      const uri = beeUri(kind, row.entry["id"]) ?? "—";
      return showRelevance
        ? [row.when, `${Math.round(row.combined * 100)}%`, row.summary, uri]
        : [row.when, row.summary, uri];
    });
  const section: CardSection | undefined =
    cardRows.length > 0
      ? {
          kind: "table",
          columns: showRelevance ? ["when", "rel.", "summary", "uri"] : ["when", "summary", "uri"],
          rows: cardRows,
        }
      : undefined;

  const payload = {
    ...record,
    query,
    results: matched.map((row) => ({
      ...row.entry,
      relevance: Number(row.combined.toFixed(4)),
    })),
  };

  return { section, payload };
}

function workerTitle(worker: CliWorker): string {
  return worker;
}

export async function agentSpec(
  prompt: string,
  onThinking?: ThinkingListener,
  onStatus?: StatusListener,
): Promise<CardSpec> {
  const runner = new AgentRunner({ mode: "cli" });
  const turn = await runner.run(prompt, {
    onStatus: (status) => {
      onStatus?.(status);
    },
    onAck: (ack) => onThinking?.(ack),
    onThinking: (thought) => onThinking?.(thought),
  });

  const flow = turn.steps.length > 0
    ? turn.steps.map((step) => `${LANE_LABELS[step.agent]} · ${step.family}`).join(" → ")
    : "conversation";
  const data = {
    answer: turn.text,
    ack: turn.ack,
    flow,
    steps: turn.steps,
    session: turn.session,
    ...(turn.clarification ? { clarification: turn.clarification } : {}),
    ...(turn.approval ? { approval: turn.approval } : {}),
    ...(turn.unsupported ? { unsupported: turn.unsupported } : {}),
  };

  if (turn.approval) {
    return {
      title: "approval needed",
      subtitle: turn.approval.tool,
      sections: [
        {
          kind: "text",
          text: "This action needs approval. Run `queen` and ask again from the TUI chat.",
        },
      ],
      data,
    };
  }
  if (turn.unsupported) {
    return {
      title: "unsupported",
      subtitle: turn.unsupported.reason,
      sections: [{ kind: "text", text: `${turn.unsupported.reason} ${turn.unsupported.suggestion}` }],
      data,
    };
  }
  if (turn.clarification) {
    return {
      title: "clarify",
      subtitle: turn.clarification,
      sections: [{ kind: "text", text: turn.clarification }],
      data,
    };
  }
  return {
    title: "queen",
    subtitle: flow,
    sections: [{ kind: "markdown", content: turn.text.trim() || "(no response)" }],
    data,
  };
}

function titleFor(decision: CliDecision): string {
  switch (decision.kind) {
    case "subcommand":
      return decision.name;
    case "external":
      return decision.name;
    case "catalog":
      return decision.id;
    case "latest":
      return `latest ${decision.kinds[0] ?? "item"}`;
    case "ir":
      return "search";
    case "action":
      return workerTitle(decision.worker);
    case "agent":
      return "queen";
    case "uri":
      return "bee";
    case "clarify":
      return "unclear";
    case "help":
      return "queen";
    default:
      return "queen";
  }
}

function commandFor(decision: CliDecision): string {
  switch (decision.kind) {
    case "help":
      return "help";
    case "subcommand":
      return `${decision.name} ${decision.argv.join(" ")}`.trim();
    case "external":
      return decision.name;
    case "catalog":
      return decision.id;
    case "latest":
      return `latest ${decision.kinds[0] ?? "item"}`;
    case "ir":
      return `search ${decision.query}`.trim();
    case "action":
    case "chat":
    case "agent":
    case "clarify":
      return decision.prompt;
    case "uri":
      return decision.uri;
    default:
      return "queen";
  }
}

function footerFor(
  decision: CliDecision,
  elapsedMs: number,
  spec: CardSpec,
  ok: boolean,
): string {
  const time = `generated in ${(elapsedMs / 1000).toFixed(1)}s`;
  if (decision.kind === "clarify") return `${time} · clarify action`;
  if (!ok) return `${time} · failed`;
  switch (decision.kind) {
    case "subcommand":
      return `${time} · bee · ${`${decision.name} ${decision.argv.join(" ")}`.trim()}`;
    case "catalog":
      return `${time} · bee · ${decision.id}`;
    case "latest":
      return `${time} · bee · latest ${decision.kinds[0] ?? "item"}`;
    case "external":
      return `${time} · queen · ${decision.name}`;
    case "ir":
      return `${time} · bee search · Avoid question words like What, How, When etc if intent is not search.`;
    case "action":
      return `${time} · ${decision.worker} agent${spec.subtitle ? ` · ${spec.subtitle}` : ""}`;
    case "agent":
      return `${time} · ${spec.subtitle ?? "conversation"}`;
    case "uri":
      return `${time} · bee · ${decision.uri}`;
    case "chat":
      return `${time} · orchestrator · direct answer`;
    case "help":
      return `${time} · queen · help`;
    default:
      return `${time} · direct action`;
  }
}

function specToData(spec: CardSpec): unknown {
  const sections = spec.sections.map((section) => {
    switch (section.kind) {
      case "table":
        return {
          kind: "table",
          columns: section.columns,
          rows: section.rows.map((row) =>
            Object.fromEntries(section.columns.map((column, index) => [column, String(row[index] ?? "")])),
          ),
        };
      case "keyValues":
        return {
          kind: "keyValues",
          items: Object.fromEntries(section.items.map((item) => [item.key, item.value])),
        };
      case "markdown":
        return { kind: "markdown", markdown: section.content };
      case "heading":
      case "text":
        return { kind: section.kind, text: section.text };
      case "gauge":
        return { kind: "gauge", label: section.label, ratio: section.ratio, detail: section.detail };
      case "progress":
        return { kind: "progress", label: section.label, ratio: section.ratio };
      default:
        return section;
    }
  });
  return {
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    sections,
  };
}

export function jsonEnvelope(result: CliResult): CliJson {
  return {
    ok: result.ok,
    kind: result.kind,
    command: result.command,
    elapsedMs: result.elapsedMs,
    ...(result.error !== undefined ? { error: result.error } : {}),
    data: result.data,
  };
}

async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const stdout = process.stdout as unknown as { write: (...args: unknown[]) => boolean };
  const write = stdout.write;
  console.log = () => {};
  stdout.write = () => true;
  try {
    return await fn();
  } finally {
    console.log = log;
    stdout.write = write;
  }
}

export async function runCli(prompt: string, options: CliOptions = {}): Promise<CliResult> {
  const inlineJson = /(^|\s)--json(?=\s|$)/.test(prompt);
  const cleanPrompt = prompt.replace(/(^|\s)--json(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  const json = options.json === true || inlineJson;
  const decision: CliDecision =
    cleanPrompt.length === 0 && json ? { kind: "help" } : decide(cleanPrompt, options.argv);
  const emit = json ? undefined : options.emit;
  const onThinking = json ? undefined : options.onThinking;
  const onStatus = json ? undefined : options.onStatus;
  const deps = options.deps ?? {};
  const started = performance.now();

  const finish = (spec: CardSpec, ok: boolean, data?: unknown, error?: string): CliResult => {
    const elapsedMs = Math.round(performance.now() - started);
    return {
      spec: { ...spec, footer: footerFor(decision, elapsedMs, spec, ok) },
      ok,
      kind: decision.kind,
      command: commandFor(decision),
      elapsedMs,
      json,
      data: data !== undefined ? data : spec.data !== undefined ? spec.data : specToData(spec),
      ...(error !== undefined ? { error } : {}),
    };
  };

  try {
    switch (decision.kind) {
      case "help":
        return finish(helpSpec(), true);
      case "subcommand":
        return finish(
          await (deps.subcommandSpec ?? subcommandSpec)(decision.name, decision.argv, { json }),
          true,
        );
      case "external": {
        const run = () => (deps.externalSpec ?? externalSpec)(decision.name, decision.argv, emit);
        return finish(json ? await silently(run) : await run(), true);
      }
      case "catalog":
        return finish(await (deps.catalogSpec ?? catalogSpec)(decision.id), true);
      case "latest":
        return finish(await (deps.latestSpec ?? latestSpec)(decision.kinds), true);
      case "ir":
        return finish(await (deps.irSpec ?? irSpec)(decision.query, decision.filter), true);
      case "action":
      case "chat":
      case "agent": {
        const spec = await (deps.agentSpec ?? agentSpec)(decision.prompt, onThinking, onStatus);
        const payload = spec.data as
          | { clarification?: unknown; approval?: unknown; unsupported?: unknown }
          | undefined;
        const ok = !payload?.clarification && !payload?.approval && !payload?.unsupported;
        return finish(spec, ok);
      }
      case "uri":
        return finish(await (deps.uriSpec ?? uriSpec)(decision.uri, { json }), true);
      case "clarify":
        return finish(clarifySpec(decision.prompt, decision.suggestions), false);
      default: {
        const error = new Error("Unhandled decision.");
        return finish(errorSpec("queen", error), false, { error: error.message }, error.message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish(errorSpec(titleFor(decision), error), false, { error: message }, message);
  }
}
