import { Message, TextBlock, type JSONSchema, type ToolSpec } from "@strands-agents/sdk";

import { callBeeTextTool } from "@/commands/mcpToolOutput";

import { loadRecentDocuments, type DocumentKind } from "../../documents";
import type { CardAlign, CardSection, CardSpec } from "../../interface/scrollback-card";
import { beeContext, buildTable, captureConsole, humanDate } from "../../utils/bee-com-bridge";
import { generate } from "../../utils/queen-ffi";
import { stripToolMarkup } from "../tool-definitions";
import { ACTION_CATALOG } from "./catalog";
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

export type CliDeps = {
  subcommandSpec?: (name: string, argv: string[]) => Promise<CardSpec>;
  externalSpec?: (name: string, argv: string[], emit?: CliEmit) => Promise<CardSpec>;
  catalogSpec?: (id: string) => Promise<CardSpec>;
  latestSpec?: (kinds: DocumentKind[]) => Promise<CardSpec>;
  irSpec?: (query: string, filter?: SearchFilter) => Promise<CardSpec>;
  actionSpec?: (worker: CliWorker, prompt: string) => Promise<CardSpec>;
  chatSpec?: (prompt: string) => Promise<CardSpec>;
};

export type CliResult = { spec: CardSpec; ok: boolean };

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


function shortDescription(text: string, max = 88): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=\.)\s/, 1)[0] ?? clean;
  return first.length > max ? `${first.slice(0, max - 3).trimEnd()}...` : first;
}

export function helpSpec(): CardSpec {
  const entries = cliMenu();
  const rows: (string | number)[][] = [
    ...entries.map((entry) => [entry.label, shortDescription(entry.description)]),
    ...EXTRA_COMMANDS.map((entry) => [entry.name, shortDescription(entry.description)]),
  ];
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
        ].join("\n"),
      },
    ],
    footer: "queen help",
  };
}

export function clarifySpec(prompt: string, suggestions: string[]): CardSpec {  return {
    title: "unclear",
    subtitle: prompt,
    sections: [
      { kind: "text", text: "Did you mean:" },
      { kind: "text", text: suggestions.map((suggestion) => `  ${suggestion}`).join("\n") },
      { kind: "text", text: "Run one of these, or run `queen` for the TUI." },
    ],
    footer: "queen",
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
      footer: "queen",
    };
  }
  if (outcome.markdown) {
    return { title, sections: [{ kind: "markdown", content: outcome.markdown }], footer: "queen" };
  }
  return { title, sections: [{ kind: "text", text: "done" }], footer: "queen" };
}

export async function subcommandSpec(name: string, argv: string[]): Promise<CardSpec> {
  const [{ resourceCommand }, ctx] = await Promise.all([import("@/commands/registry"), beeContext("prod")]);
  const command = resourceCommand(name);
  const text = await captureConsole(() => command.run(argv, ctx));
  return {
    title: name,
    subtitle: argv.length > 0 ? argv.join(" ") : command.description,
    sections: [{ kind: "markdown", content: text.length > 0 ? text : "done" }],
    footer: "queen",
  };
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
      footer: "queen",
    };
  }
  return {
    title: doc.title,
    subtitle: doc.subtitle,
    sections: [{ kind: "markdown", content: doc.body || doc.markdown }],
    footer: "queen",
  };
}

export async function irSpec(query: string, filter?: SearchFilter): Promise<CardSpec> {
  const ctx = await beeContext("prod");
  const data = await callBeeTextTool(ctx, "bee_search", {
    query,
    mode: "semantic",
    limit: 20,
    ...(filter !== undefined && filter !== "all" ? { filter } : {}),
  });
  const compact = compactSearch(data);
  if (compact) {
    return {
      title: "search",
      subtitle: query,
      sections: [compact],
      footer: "queen",
    };
  }
  const table = buildTable(data);
  if (table) {
    return {
      title: "search",
      subtitle: query,
      sections: [sectionForTable(table)],
      footer: "queen",
    };
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
    footer: "queen",
  };
}

function clip(value: unknown, max = 140): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function cleanSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^#+\s*Summary\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep CLI search output readable: one line per hit, no full summaries. */
function compactSearch(data: unknown): CardSection | undefined {
  if (!data || typeof data !== "object") return undefined;
  const results = (data as Record<string, unknown>)["results"];
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const rows: (string | number)[][] = [];
  for (const item of results.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const when = humanDate(
      record["started_at"] ?? record["created_at"] ?? record["date_time"] ?? record["date"],
    );
    const summary = clip(
      cleanSummary(
        record["short_summary"] ?? record["summary"] ?? record["detailed_summary"] ?? record["text"],
      ),
    );
    if (summary.length > 0) rows.push([when, summary]);
  }
  if (rows.length === 0) return undefined;
  return { kind: "table", columns: ["when", "summary"], rows };
}

export async function chatSpec(prompt: string): Promise<CardSpec> {
  const text = stripToolMarkup(generate({ prompt })).trim();
  return {
    title: "queen",
    subtitle: "answer",
    sections: [{ kind: "markdown", content: text.length > 0 ? text : "(no response)" }],
    footer: "queen",
  };
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const content = (value as { content?: readonly { text?: unknown }[] }).content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === "string" ? item.text : JSON.stringify(item)))
        .join("\n");
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function tableFromText(text: string): CardSection | undefined {
  try {
    const table = buildTable(JSON.parse(text) as unknown);
    return table ? sectionForTable(table) : undefined;
  } catch {
    return undefined;
  }
}

function workerTitle(worker: CliWorker): string {
  if (worker === "mac") return "mac";
  if (worker === "net") return "web";
  return "bee";
}

type CliTool = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  invoke: (args: Record<string, unknown>) => Promise<unknown>;
};

function trimDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=\.)\s/, 1)[0] ?? clean;
  return first.length > 100 ? `${first.slice(0, 97).trimEnd()}...` : first;
}

async function cliTools(worker: CliWorker): Promise<CliTool[]> {
  if (worker === "bee") {
    const [{ BEE_MCP_TOOLS }, { callBeeTool }, ctx] = await Promise.all([
      import("@/mcp/toolDefinitions"),
      import("@/mcp/toolRegistry"),
      beeContext("prod"),
    ]);
    return BEE_MCP_TOOLS.map((entry) => ({
      name: entry.name,
      description: trimDescription(entry.description),
      inputSchema: entry.inputSchema as JSONSchema,
      invoke: (args) => callBeeTool(ctx, entry.name, args),
    }));
  }
  if (worker === "mac") {
    const { automationDefs } = await import("../automation");
    return automationDefs().map((entry) => ({
      name: entry.name,
      description: trimDescription(entry.description),
      inputSchema: entry.inputSchema,
      invoke: (args) => entry.run(args),
    }));
  }
  const { toolsForWorker } = await import("../tools-execution");
  return toolsForWorker("net").map((entry) => ({
    name: entry.name,
    description: trimDescription(entry.description),
    inputSchema: entry.toolSpec.inputSchema ?? ({ type: "object", properties: {} } as JSONSchema),
    invoke: (args) =>
      (entry as unknown as { invoke: (input: Record<string, unknown>) => Promise<unknown> }).invoke(
        args,
      ),
  }));
}

async function selectAndRun(worker: CliWorker, prompt: string): Promise<{ name: string; result: string }> {
  const [{ riskOf }, { ElthurModel }] = await Promise.all([
    import("../tools-execution"),
    import("../strands-model"),
  ]);
  const tools = await cliTools(worker);
  if (tools.length === 0) throw new Error(`No ${worker} tools are available on this platform.`);

  const system = `You are the "${worker}" tool selector for Queen. Choose exactly one tool and fill its arguments. Never explain. If no tool fits, output nothing.`;
  const model = new ElthurModel({ maxTokens: 256, systemPrompt: system });
  const messages: Message[] = [
    new Message({ role: "user", content: [new TextBlock(prompt)] }),
  ];
  const specs: ToolSpec[] = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

  let name = "";
  let argsText = "";
  for await (const event of model.stream(messages, { toolSpecs: specs, systemPrompt: system })) {
    const record = event as unknown as Record<string, unknown>;
    if (record["type"] === "modelContentBlockStartEvent") {
      const start = record["start"] as { type?: string; name?: string } | undefined;
      if (start?.type === "toolUseStart" && typeof start.name === "string") {
        name = start.name;
        argsText = "";
      }
    } else if (record["type"] === "modelContentBlockDeltaEvent") {
      const delta = record["delta"] as { type?: string; input?: string } | undefined;
      if (delta?.type === "toolUseInputDelta" && typeof delta.input === "string") {
        argsText += delta.input;
      }
    }
  }

  if (name.length === 0) {
    throw new Error("I couldn't tell which action you meant. Try `queen help`, or ask in the TUI.");
  }
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Selected an unknown tool: ${name}`);
  if (riskOf(name) === "high") {
    throw new Error(`"${name}" is high-risk, so it needs the TUI. Run \`queen\` and ask in chat.`);
  }

  let args: Record<string, unknown> = {};
  if (argsText.trim().length > 0) {
    try {
      args = JSON.parse(argsText) as Record<string, unknown>;
    } catch {
      throw new Error(`Could not parse the arguments for ${name}.`);
    }
  }
  return { name, result: resultText(await tool.invoke(args)) };
}

export async function actionSpec(worker: CliWorker, prompt: string): Promise<CardSpec> {
  const { name, result } = await selectAndRun(worker, prompt);
  const table = tableFromText(result);
  return {
    title: workerTitle(worker),
    subtitle: name,
    sections: [table ?? { kind: "markdown", content: result.trim() || "done" }],
    footer: "queen",
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
    case "clarify":
      return "unclear";
    case "help":
      return "queen";
    default:
      return "queen";
  }
}

export async function runCli(
  prompt: string,
  options: { emit?: CliEmit; deps?: CliDeps } = {},
): Promise<CliResult> {
  const emit = options.emit;
  const deps = options.deps ?? {};
  const decision = decide(prompt);

  try {
    switch (decision.kind) {
      case "help":
        return { spec: helpSpec(), ok: true };
      case "subcommand":
        return {
          spec: await (deps.subcommandSpec ?? subcommandSpec)(decision.name, decision.argv),
          ok: true,
        };
      case "external":
        return {
          spec: await (deps.externalSpec ?? externalSpec)(decision.name, decision.argv, emit),
          ok: true,
        };
      case "catalog":
        return { spec: await (deps.catalogSpec ?? catalogSpec)(decision.id), ok: true };
      case "latest":
        return { spec: await (deps.latestSpec ?? latestSpec)(decision.kinds), ok: true };
      case "ir":
        return { spec: await (deps.irSpec ?? irSpec)(decision.query, decision.filter), ok: true };
      case "action":
        return { spec: await (deps.actionSpec ?? actionSpec)(decision.worker, decision.prompt), ok: true };
      case "chat":
        return { spec: await (deps.chatSpec ?? chatSpec)(decision.prompt), ok: true };
      case "clarify":
        return { spec: clarifySpec(decision.prompt, decision.suggestions), ok: false };
      default:
        return { spec: errorSpec("queen", new Error("Unhandled decision.")), ok: false };
    }
  } catch (error) {
    return { spec: errorSpec(titleFor(decision), error), ok: false };
  }
}
