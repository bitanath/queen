import { RESOURCES } from "@/resources";

import type { DocumentKind } from "../../documents";
import { classifyRequest } from "../agents/orchestrator";

export type CliWorker = "bee" | "mac" | "net";
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

const RESOURCE_INFO = new Map<string, { canonical: string; hasSubcommands: boolean }>();
for (const resource of RESOURCES) {
  const cliActions = resource.actions.filter((action) => action.cli !== undefined);
  if (cliActions.length === 0) continue;
  const name = resource.cliCommand.name;
  const hasSubcommands = cliActions.some((action) => action.cli?.subcommand !== undefined);
  RESOURCE_INFO.set(name, { canonical: name, hasSubcommands });
  for (const alias of resource.cliCommand.aliases ?? []) {
    RESOURCE_INFO.set(alias, { canonical: name, hasSubcommands });
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
  if (info.hasSubcommands) return true;
  if (rest.length === 0) return true;
  return (rest[0] ?? "").startsWith("-");
} //FIXME: queen search --query should not conflict with queen "search for my last todo"

const LIST_ACTION: Record<DocumentKind, string> = {
  todo: "todos list",
  fact: "facts list",
  insight: "insights list",
  journal: "journals list",
  daily: "daily list",
  conversation: "conversations list",
  location: "locations recent",
};

const KIND_PATTERNS: readonly [RegExp, DocumentKind][] = [
  [/\btodos?\b|\btasks?\b/, "todo"],
  [/\bfacts?\b/, "fact"],
  [/\binsights?\b/, "insight"],
  [/\bjournals?\b|\bvoice ?notes?\b/, "journal"],
  [/\bdaily\b|\bsumm(?:ary|aries)\b/, "daily"],
  [/\bconversations?\b|\btranscripts?\b|\butterances?\b/, "conversation"],
  [/\blocations?\b|\bvisits?\b/, "location"],
];

const LATEST = /\b(latest|newest|most recent|last)\b/;
const LIST = /\b(list|show|display|recent|all)\b/;
const WRITE =
  /\b(add|create|make|new|save|set|put|log|track|remember|remind|schedule|draft|send|text|message|email|update|edit|delete|remove|mark|complete|finish|open|play|pause|toggle|turn|launch)\b/;

const MAC = [
  /\bremind(er|ers|ing)?\b/,
  /\bcalendar\b/,
  /\bmeeting\b/,
  /\bappointment\b/,
  /\bcontacts?\b/,
  /\bemails?\b/,
  /\bmail\b/,
  /\bimessages?\b/,
  /\bsms\b/,
  /\btexts?\b/,
  /\bdirections?\b/,
  /\bnavigate\b/,
  /\bmaps?\b/,
  /\bmusic\b/,
  /\bsong\b/,
  /\bclipboard\b/,
  /\bpaste\b/,
  /\bnotif(y|ication|ications)\b/,
  /\bfinder\b/,
  /\breveal\b/,
  /\bshortcut\b/,
  /\bdark mode\b/,
  /\bbattery\b/,
  /\bscreenshot\b/,
  /\bvolume\b/,
  /\bbrightness\b/,
  /\bsiri\b/,
  /\bopen\b/,
  /\blaunch\b/,
];

const NET = [
  /\bweather\b/,
  /\bforecast\b/,
  /\bsearch (the )?web\b/,
  /\bweb search\b/,
  /\bgoogle\b/,
  /\bonline\b/,
  /\bwikipedia\b/,
  /\bnews\b/,
  /\bcapital of\b/,
  /\bhttps?:\/\//,
  /\bapi\b/,
  /\bfetch\b/,
  /\btranslate\b/,
  /\bstock price\b/,
  /\bexchange rate\b/,
  /\binternet\b/,
];

const BEE_WRITE = [
  /\btodos?\b/,
  /\btasks?\b/,
  /\bfacts?\b/,
  /\binsights?\b/,
  /\bjournals?\b/,
  /\bvoice ?notes?\b/,
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\u2019']/g, "");
}

function any(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function kindOf(text: string): DocumentKind | undefined {
  for (const [pattern, kind] of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return undefined;
}

function isQuestion(text: string): boolean {
  return (
    /^(what|whats|where|whens|who|whom|whose|why|hows|how|which|when|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)\b/.test(
      text,
    ) || text.endsWith("?")
  );
}

function externalAlias(text: string): string | undefined {
  if (/\b(my name|profile)\b/.test(text)) return "me";
  if (/\bbrief\b/.test(text)) return "today";
  if (/\b(reachable|ping|connectivity)\b/.test(text)) return "ping";
  if (/\b(am i logged in|login status|connection status)\b/.test(text)) return "status";
  if (/\bversion\b/.test(text)) return "version";
  if (/\b(recently changed|what changed|has changed)\b/.test(text)) return "changed";
  if (/\bjust now\b/.test(text)) return "now";
  return undefined;
}

function searchFilter(text: string): SearchFilter | undefined {
  if (/\bfacts?\b/.test(text)) return "facts";
  if (/\bdaily\b|\bsumm(?:ary|aries)\b/.test(text)) return "daily";
  if (/\bconversations?\b|\btranscripts?\b/.test(text)) return "conversations";
  return undefined;
}

function searchQuery(raw: string): string {
  const stripped = raw
    .replace(
      /^(search( my (facts|conversations|daily summaries))?( for)?|find|show me|tell me|what did i (say|hear|talk|do) about|what did i (say|hear|talk|do))\s+/i,
      "",
    )
    .replace(/[?.!]+$/, "")
    .trim();
  return stripped.length > 0 ? stripped : raw.trim();
}

function ir(raw: string, text: string): CliDecision {
  const filter = searchFilter(text);
  return {
    kind: "ir",
    query: searchQuery(raw),
    ...(filter !== undefined ? { filter } : {}),
  };
}

function suggestionCommands(prompt: string, text: string): string[] {
  const suggestions: string[] = [];
  if (/\btodos?\b|\btasks?\b/.test(text)) {
    suggestions.push('queen todos create --text "<what to do>"');
  }
  if (/\bfacts?\b/.test(text)) {
    suggestions.push('queen facts create --text "<fact>"');
  }
  suggestions.push(`queen "${prompt} on my Mac"`);
  if (suggestions.length < 2) {
    suggestions.push(`queen "${prompt} in Bee"`);
  }
  return [...new Set(suggestions)];
}

function clarify(prompt: string, text: string): CliDecision {
  return { kind: "clarify", prompt, suggestions: suggestionCommands(prompt, text) };
}

export function decide(prompt: string): CliDecision {
  const raw = prompt.trim();
  if (raw.length === 0) return { kind: "chat", prompt: raw };

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

  const text = normalize(raw);
  const cls = classifyRequest(raw);

  const alias = externalAlias(text);
  if (alias !== undefined) return { kind: "external", name: alias, argv: [] };

  if (/\bwhere am i\b/.test(text)) return { kind: "catalog", id: "locations current" };
  if (/\bwhere have i been\b|\bspending time\b/.test(text)) {
    return { kind: "catalog", id: "locations clusters" };
  }

  const kind = kindOf(text);
  const write = WRITE.test(text);

  if (kind !== undefined) {
    if (LATEST.test(text) && !write) return { kind: "latest", kinds: [kind] };
    if (LIST.test(text) && !write) return { kind: "catalog", id: LIST_ACTION[kind] };
  }

  if (write) {
    // "note" is genuinely ambiguous: a Bee journal or an Apple Note.
    if (/\bnotes?\b/.test(text)) return clarify(raw, text);
    if (any(text, MAC)) return { kind: "action", worker: "mac", prompt: raw };
    if (any(text, BEE_WRITE)) return { kind: "action", worker: "bee", prompt: raw };
    if (cls === "mac" || cls === "net" || cls === "bee") {
      return { kind: "action", worker: cls, prompt: raw };
    }
    return clarify(raw, text);
  }

  if (isQuestion(text)) {
    const recollect = /\b(mention|mentioned|say|said|talk|talked|hear|heard|discuss|discussed)\b/.test(text);
    if (cls === "mac") return { kind: "action", worker: "mac", prompt: raw };
    if (cls === "net") return { kind: "action", worker: "net", prompt: raw };
    if (cls === "bee" || recollect) return ir(raw, text);
    return { kind: "chat", prompt: raw };
  }

  if (cls === "mac") return { kind: "action", worker: "mac", prompt: raw };
  if (cls === "net") return { kind: "action", worker: "net", prompt: raw };
  if (cls === "bee") return ir(raw, text);
  if (cls === "ambiguous") return clarify(raw, text);
  return { kind: "chat", prompt: raw };
}
