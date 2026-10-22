import { RESOURCES } from "@/resources";

import type { DocumentKind } from "../../documents";

export type CliWorker = "bee" | "mac" | "linux";
export type SearchFilter = "all" | "conversations" | "daily" | "facts";

export type CliDecision =
  | { kind: "help" }
  | { kind: "subcommand"; name: string; argv: string[] }
  | { kind: "external"; name: string; argv: string[] }
  | { kind: "catalog"; id: string }
  | { kind: "latest"; kinds: DocumentKind[] }
  | { kind: "ir"; query: string; filter?: SearchFilter }
  | { kind: "action"; worker: CliWorker; prompt: string }
  | { kind: "chat"; prompt: string }
  | { kind: "agent"; prompt: string }
  | { kind: "uri"; uri: string }
  | { kind: "clarify"; prompt: string; suggestions: string[] };

export type CliMenuEntry = {
  resource: string;
  aliases: readonly string[];
  subcommand?: string;
  label: string;
  description: string;
};

export const EXTRA_COMMANDS: readonly { name: string; description: string }[] = [
  { name: "status", description: "auth + connection status" },
  { name: "today", description: "today's brief (calendar + email)" },
  { name: "now", description: "recent conversations with utterances" },
  { name: "changed", description: "recently changed entities" },
  { name: "me", description: "your Bee profile" },
  { name: "ping", description: "connectivity check" },
  { name: "version", description: "queen + pinned Bee CLI version" },
  { name: "sync", description: "export Bee data to markdown" },
  { name: "login", description: "connect your Bee account" },
  { name: "logout", description: "clear Bee credentials" },
];

export const EXTERNAL_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "today",
  "now",
  "changed",
  "me",
  "logout",
  "ping",
  "version",
  "sync",
  "login",
]);

export function cliMenu(): CliMenuEntry[] {
  const entries: CliMenuEntry[] = [];
  for (const resource of RESOURCES) {
    const cliActions = resource.actions.filter((action) => action.cli !== undefined);
    if (cliActions.length === 0) continue;
    const name = resource.cliCommand.name;
    if (EXTERNAL_COMMANDS.has(name)) continue; // queen-owned command wins
    const aliases = resource.cliCommand.aliases ?? [];
    const usesSubcommands = cliActions.some((action) => action.cli?.subcommand !== undefined);
    if (!usesSubcommands) {
      entries.push({
        resource: name,
        aliases,
        label: name,
        description: resource.cliCommand.description,
      });
      continue;
    }
    for (const action of cliActions) {
      const subcommand = action.cli?.subcommand;
      if (subcommand === undefined) continue;
      entries.push({
        resource: name,
        aliases,
        subcommand,
        label: `${name} ${subcommand}`,
        description: action.mcp?.description ?? resource.cliCommand.description,
      });
    }
  }
  return entries;
}

const RESOURCE_INFO = new Map<
  string,
  { canonical: string; hasSubcommands: boolean; subcommands: Set<string> }
>();
for (const resource of RESOURCES) {
  const cliActions = resource.actions.filter((action) => action.cli !== undefined);
  if (cliActions.length === 0) continue;
  const name = resource.cliCommand.name;
  const hasSubcommands = cliActions.some((action) => action.cli?.subcommand !== undefined);
  const subcommands = new Set(
    cliActions
      .map((action) => action.cli?.subcommand)
      .filter((subcommand): subcommand is string => subcommand !== undefined),
  );
  RESOURCE_INFO.set(name, { canonical: name, hasSubcommands, subcommands });
  for (const alias of resource.cliCommand.aliases ?? []) {
    RESOURCE_INFO.set(alias, { canonical: name, hasSubcommands, subcommands });
  }
}

export function isResourceName(name: string): boolean {
  return RESOURCE_INFO.has(name);
}

export function resolveResourceName(name: string): string {
  return RESOURCE_INFO.get(name)?.canonical ?? name;
}

function looksLikeCliCommand(first: string, rest: string[]): boolean {
  const info = RESOURCE_INFO.get(first);
  if (!info) return false;
  if (info.hasSubcommands) {
    if (rest.length === 0) return true;
    const sub = rest[0] ?? "";
    return info.subcommands.has(sub) || sub.startsWith("-");
  }
  if (rest.length === 0) return true;
  return (rest[0] ?? "").startsWith("-");
} //FIXME: queen search --query should not conflict with queen "search for my last todo"

const SEARCH_VALUE_FLAGS = new Set([
  "--query", "--limit", "--since", "--until", "--filter", "--scope", "--sort", "--sortBy", "--cursor",
]);

function normalizeSearchArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  const positionals: string[] = [];
  let hasQuery = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      out.push(arg);
      if (arg === "--query") hasQuery = true;
      const next = args[index + 1];
      if (SEARCH_VALUE_FLAGS.has(arg) && next !== undefined && !next.startsWith("--")) {
        out.push(next);
        index += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  if (hasQuery) return out;
  const query = positionals.join(" ").trim();
  return query.length > 0 ? ["--query", query, ...out] : out;
}

export function decide(prompt: string, argv?: readonly string[]): CliDecision {
  const raw = prompt.trim();
  if (raw.length === 0) return { kind: "chat", prompt: raw };
  if (/^bee:\/\//i.test(raw)) return { kind: "uri", uri: raw };
  if (argv?.[0] === "search" && argv.length > 1) {
    return { kind: "subcommand", name: "search", argv: normalizeSearchArgs(argv.slice(1)) };
  }

  const tokens = raw.split(/\s+/);
  const first = (tokens[0] ?? "").toLowerCase().replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, "");

  if (first === "help" || first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v") return { kind: "external", name: "version", argv: [] };
  if (EXTERNAL_COMMANDS.has(first)) {
    return { kind: "external", name: first, argv: tokens.slice(1) };
  }
  const rest = tokens.slice(1);
  if (looksLikeCliCommand(first, rest)) {
    return { kind: "subcommand", name: resolveResourceName(first), argv: rest };
  }

  return { kind: "agent", prompt: raw };
}
