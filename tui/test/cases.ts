import { automationDefs, hostAgentName } from "../src/functions/automation";

export type RouteAgent = "bee" | "mac" | "linux" | "none" | "clarify";

export type CaseClass = "recall" | "precision" | "ambiguous";

export type RouteCase = {
  id: string;
  prompt: string;
  agent: RouteAgent;
  tool?: string;
  /** FIXME: Claude coded branching test class; inferred from `agent` when omitted. */
  class?: CaseClass;
};

export function classOf(c: RouteCase): CaseClass {
  if (c.class) return c.class;
  if (c.agent === "none") return "precision";
  if (c.agent === "clarify") return "ambiguous";
  return "recall";
}

const CATALOG_CASES: RouteCase[] = [
  { id: "catalog:activity:list", prompt: "what have I been up to recently", agent: "bee", tool: "bee_get_recent_activity" },
  { id: "catalog:conversations:list", prompt: "list my recent conversations", agent: "bee", tool: "bee_list_conversations" },
  { id: "catalog:conversations:related", prompt: "find conversations related to this one", agent: "bee" },
  { id: "catalog:daily:list", prompt: "list my daily summaries", agent: "bee", tool: "bee_list_daily_summaries" },
  { id: "catalog:external-access:list", prompt: "which services have accessed my bee data", agent: "bee", tool: "bee_list_external_access" },
  { id: "catalog:facts:list", prompt: "list my saved facts", agent: "bee", tool: "bee_list_facts" },
  { id: "catalog:facts:search", prompt: "search my facts for coffee", agent: "bee" },
  { id: "catalog:facts:create", prompt: "save a fact: I prefer oat milk", agent: "bee" },
  { id: "catalog:facts:update", prompt: "update that fact with the correct wording", agent: "bee" },
  { id: "catalog:insights:list", prompt: "show me my insights", agent: "bee", tool: "bee_get_insights" },
  { id: "catalog:journals:list", prompt: "list my voice notes", agent: "bee", tool: "bee_list_voice_notes" },
  { id: "catalog:journals:search", prompt: "search my journals for the project", agent: "bee" },
  { id: "catalog:todos:list", prompt: "list my todos", agent: "bee", tool: "bee_list_todos" },
  { id: "catalog:todos:create", prompt: "add a todo to buy milk", agent: "clarify" },
  { id: "catalog:todos:complete", prompt: "mark that todo as complete", agent: "clarify" },
  { id: "catalog:todos:suggestions", prompt: "review my suggested todos", agent: "bee" },
  { id: "catalog:locations:clusters", prompt: "where have I been spending time lately", agent: "bee", tool: "bee_get_location_clusters" },
  { id: "catalog:locations:recent", prompt: "show my recent visits", agent: "bee", tool: "bee_get_recent_visits" },
  { id: "catalog:locations:current", prompt: "where am I right now", agent: "bee", tool: "bee_get_current_location" },
  { id: "catalog:photos:list", prompt: "list my bee photos", agent: "bee", tool: "bee_get_photos" },
  { id: "catalog:search:list", prompt: "search my conversations for the budget", agent: "bee" },
];

const EXTERNAL_CASES: RouteCase[] = [
  { id: "ext:status", prompt: "am I logged in to bee", agent: "bee" },
  { id: "ext:today", prompt: "what's my brief for today", agent: "bee" },
  { id: "ext:now", prompt: "what conversations were captured just now", agent: "bee" },
  { id: "ext:changed", prompt: "what has changed recently in bee", agent: "bee" },
  { id: "ext:me", prompt: "what's my name in my bee profile", agent: "bee" },
  { id: "ext:ping", prompt: "is bee reachable", agent: "bee" },
  { id: "ext:version", prompt: "what version of queen is this", agent: "none" },
]; //FIXME: Direct actions replicating the Bee CLi

const AUTOMATION_INTENTS: Record<string, string> = {
  os_open_url: "open example.com in my browser",
  os_open_app: "open safari",
  os_show_location: "show this address on the map",
  os_directions: "give me directions to the airport",
  os_add_reminder: "remind me to call mum tomorrow at 9",
  os_add_calendar_event: "add a meeting to my calendar tomorrow at 3pm",
  os_create_note: "save this in my notes",
  os_add_contact: "add a contact for Jane Doe",
  os_mail_draft: "draft an email to bob about lunch",
  os_send_imessage: "text jane that I'm running late",
  os_music: "pause the music",
  os_clipboard_get: "what's on the clipboard",
  os_clipboard_set: "copy this text to the clipboard",
  os_notify: "send me a notification saying done",
  os_reveal: "show my downloads folder in finder",
  os_run_shortcut: "run my shortcut called morning",
  os_toggle_dark_mode: "toggle dark mode",
  os_system_status: "how's my battery",
};

const NEGATIVE_CASES: RouteCase[] = [
  { id: "neg:greeting", prompt: "hey there", agent: "none" },
  { id: "neg:math", prompt: "what is 2 plus 2", agent: "none" },
  { id: "neg:thanks", prompt: "thanks, that's great", agent: "none" },
  { id: "precision:weather-opinion", prompt: "I'm liking the weather in Paris today", agent: "none" },
  { id: "precision:sky", prompt: "the sky looks nice today", agent: "none" },
  { id: "precision:magnets", prompt: "how do magnets work?", agent: "none" },
  { id: "precision:opinion", prompt: "I think minimalism is underrated", agent: "none" },
  { id: "precision:banter", prompt: "hmm that's interesting", agent: "none" },
];

function automationCases(): RouteCase[] {
  const OVERRIDE: Record<string, RouteAgent> = { os_create_note: "clarify" };
  const host = hostAgentName() ?? "mac";
  return automationDefs().map((def) => ({
    id: `auto:${def.name}`,
    prompt: AUTOMATION_INTENTS[def.name] ?? `use the ${def.name} action`,
    agent: OVERRIDE[def.name] ?? host,
    tool: OVERRIDE[def.name] ? undefined : def.name,
  }));
}

export const ROUTE_CASES: RouteCase[] = [
  ...CATALOG_CASES,
  ...EXTERNAL_CASES,
  ...automationCases(),
  ...NEGATIVE_CASES,
];

/** Categories of prompt we deliberately test. */
export const MANIFEST = {
  catalog: CATALOG_CASES,
  external: EXTERNAL_CASES,
  negatives: NEGATIVE_CASES,
  automations: automationCases(),
};

export function casesFor(filter: string | undefined): RouteCase[] {
  if (!filter) return ROUTE_CASES;
  const needle = filter.toLowerCase();
  return ROUTE_CASES.filter((c) => c.id.toLowerCase().includes(needle) || c.prompt.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// Heuristic classifier cases (offline — no model). Tested in Tier A.
// ---------------------------------------------------------------------------

import type { DocFilter } from "../src/functions/ui-bridge";
import { cliMenu, type CliDecision } from "../src/functions/action/cli-menu";
import type { RouteClass } from "../src/functions/agents/orchestrator";

export type HeuristicCase = { text: string; expected: RouteClass; doc?: string };

export const HEURISTIC_CASES: HeuristicCase[] = [
  // --- recall: bee -------------------------------------------------------
  { text: "list my recent conversations", expected: "bee" },
  { text: "what did I talk about yesterday", expected: "bee" },
  { text: "list my saved facts", expected: "bee" },
  { text: "search my facts for coffee", expected: "bee" },
  { text: "show me my insights", expected: "bee" },
  { text: "list my voice notes", expected: "bee" },
  { text: "list my todos", expected: "bee" },
  { text: "search my journals for the project", expected: "bee" },
  { text: "where have I been spending time lately", expected: "bee" },
  { text: "show my recent visits", expected: "bee" },
  { text: "where am I right now", expected: "bee" },
  { text: "list my bee photos", expected: "bee" },
  { text: "which services have accessed my bee data", expected: "bee" },
  { text: "what's my name in my bee profile", expected: "bee" },
  { text: "what's my brief for today", expected: "bee" },
  { text: "is bee reachable", expected: "bee" },
  { text: "what has changed recently in bee", expected: "bee" },
  { text: "summarise this conversation", expected: "bee" },

  // --- recall: mac -------------------------------------------------------
  { text: "remind me to call mum tomorrow at 9", expected: "mac" },
  { text: "add a meeting to my calendar tomorrow at 3pm", expected: "mac" },
  { text: "show this address on the map", expected: "mac" },
  { text: "give me directions to the airport", expected: "mac" },
  { text: "draft an email to bob about lunch", expected: "mac" },
  { text: "text jane that I'm running late", expected: "mac" },
  { text: "pause the music", expected: "mac" },
  { text: "what's on the clipboard", expected: "mac" },
  { text: "copy this text to the clipboard", expected: "mac" },
  { text: "send me a notification saying done", expected: "mac" },
  { text: "show my downloads folder in finder", expected: "mac" },
  { text: "run my shortcut called morning", expected: "mac" },
  { text: "toggle dark mode", expected: "mac" },
  { text: "how's my battery", expected: "mac" },
  { text: "open safari", expected: "mac" },
  { text: "open example.com in my browser", expected: "mac" },

  // --- search always means Bee search -----------------------------------
  { text: "search the web for the capital of australia", expected: "bee" },
  { text: "what's the weather in tokyo", expected: "none" },
  { text: "fetch example.com and summarise it", expected: "none" },

  // --- precision: no tool at all ----------------------------------------
  { text: "I'm liking the weather in Paris today", expected: "none" },
  { text: "the sky looks nice today", expected: "none" },
  { text: "what is 2 plus 2", expected: "none" },
  { text: "how do magnets work?", expected: "none" },
  { text: "tell me a joke", expected: "none" },
  { text: "hey there", expected: "none" },
  { text: "thanks, that's great", expected: "none" },
  { text: "hmm that's interesting", expected: "none" },
  { text: "I think minimalism is underrated", expected: "none" },
  { text: "what do you think about coffee", expected: "none" },

  // --- ambiguous: ask once ----------------------------------------------
  { text: "add a todo to buy milk", expected: "ambiguous" },
  { text: "save this in my notes", expected: "ambiguous" },
  { text: "create a task for tomorrow", expected: "ambiguous" },
  { text: "add a note about lunch", expected: "ambiguous" },
  { text: "mark that todo as complete", expected: "ambiguous" },
  { text: "mark that todo as complete", doc: "todo", expected: "bee" }, // open doc disambiguates
  { text: "summarise this", doc: "daily", expected: "bee" },
];



//TODO One-shot CLI: input resolution, deterministic decisions, SSE refresh mapping.

export type CliInputCase = {
  id: string;
  argv: string[];
  tty: boolean;
  stdin?: string;
  expect: string | null;
};

export const CLI_INPUT_CASES: CliInputCase[] = [
  { id: "input:bare-tty", argv: [], tty: true, expect: null },
  { id: "input:status", argv: ["status"], tty: true, expect: "status" },
  { id: "input:words", argv: ["show", "latest", "todo"], tty: true, expect: "show latest todo" },
  { id: "input:quoted", argv: ["show latest todo"], tty: true, expect: "show latest todo" },
  { id: "input:stdin-ignored-on-tty", argv: [], tty: true, stdin: "show latest todo", expect: null },
  { id: "input:stdin-pipe", argv: [], tty: false, stdin: "show latest todo\n", expect: "show latest todo" },
  { id: "input:stdin-blank", argv: [], tty: false, stdin: "  \n\t", expect: null },
  { id: "input:argv-wins", argv: ["todos", "list"], tty: false, stdin: "ignored", expect: "todos list" },
];

export type CliDecisionCase = {
  id: string;
  prompt: string;
  kind: CliDecision["kind"];
  name?: string;
  catalogId?: string;
  worker?: "bee" | "mac" | "linux";
  kinds?: string[];
  filter?: string;
  query?: string;
  suggestionIncludes?: string[];
};

export const SUBCOMMAND_CASES: CliDecisionCase[] = cliMenu().map((entry) => ({
  id: `sub:${entry.label.replace(/\s+/g, "-")}`,
  prompt: entry.label,
  kind: "subcommand" as const,
  name: entry.resource,
}));

export const CLI_DECISION_CASES: CliDecisionCase[] = [
  ...SUBCOMMAND_CASES,

  { id: "ext:status", prompt: "status", kind: "external", name: "status" },
  { id: "ext:today", prompt: "today", kind: "external", name: "today" },
  { id: "ext:now", prompt: "now", kind: "external", name: "now" },
  { id: "ext:changed", prompt: "changed", kind: "external", name: "changed" },
  { id: "ext:me", prompt: "me", kind: "external", name: "me" },
  { id: "ext:logout", prompt: "logout", kind: "external", name: "logout" },
  { id: "ext:ping", prompt: "ping", kind: "external", name: "ping" },
  { id: "ext:version", prompt: "version", kind: "external", name: "version" },
  { id: "ext:sync", prompt: "sync", kind: "external", name: "sync" },
  { id: "ext:login", prompt: "login", kind: "external", name: "login" },
  { id: "uri:conversation", prompt: "bee://conversations/10414635", kind: "uri" },
  { id: "uri:fact", prompt: "bee://facts/123", kind: "uri" },
  { id: "uri:unknown", prompt: "bee://bogus/123", kind: "uri" },
  { id: "ir:say", prompt: "what did I say about the budget", kind: "ir" },
  { id: "ir:talk", prompt: "what did I talk about yesterday", kind: "ir" },
  { id: "ir:facts", prompt: "search my facts for coffee", kind: "ir" },
  { id: "ir:mention", prompt: "did I mention coffee", kind: "agent" },
  { id: "ir:lookup", prompt: "look up voice recorder", kind: "ir" },
  { id: "ir:free-status", prompt: "am I logged in to bee", kind: "agent" },
  { id: "ir:free-today", prompt: "what's my brief for today", kind: "ir" },
  { id: "ir:free-now", prompt: "what conversations were captured just now", kind: "ir" },
  { id: "ir:free-changed", prompt: "what has changed recently in bee", kind: "ir" },
  { id: "ir:free-me", prompt: "what's my name in my bee profile", kind: "ir" },
  { id: "ir:free-ping", prompt: "is bee reachable", kind: "agent" },
  { id: "ir:free-version", prompt: "what version of queen is this", kind: "ir" },

  { id: "agent:list-todos", prompt: "list my todos", kind: "agent" },
  { id: "agent:list-facts", prompt: "list my saved facts", kind: "agent" },
  { id: "agent:list-insights", prompt: "show me my insights", kind: "agent" },
  { id: "agent:list-journals", prompt: "list my voice notes", kind: "agent" },
  { id: "agent:list-locations", prompt: "show my recent visits", kind: "agent" },
  { id: "agent:current-location", prompt: "where am I right now", kind: "ir" },
  { id: "agent:location-clusters", prompt: "where have I been spending time lately", kind: "ir" },

  { id: "latest:todo", prompt: "show latest todo", kind: "latest", kinds: ["todo"] },
  { id: "latest:fact", prompt: "latest fact", kind: "latest", kinds: ["fact"] },
  { id: "latest:journal", prompt: "newest voice note", kind: "latest", kinds: ["journal"] },
  { id: "agent:last-conversations", prompt: "show me last 10 conversations", kind: "agent" },

  { id: "agent:todo-free", prompt: "make me a todo saying this is the chonkiest due by tomorrow", kind: "agent" },
  { id: "agent:todo-add", prompt: "add a todo to buy milk", kind: "agent" },
  { id: "agent:reminder", prompt: "remind me to call mum tomorrow at 9", kind: "agent" },
  { id: "agent:calendar", prompt: "create a calendar event tomorrow at 3pm", kind: "agent" },
  { id: "agent:open", prompt: "open safari", kind: "agent" },
  { id: "agent:music", prompt: "pause the music", kind: "agent" },
  { id: "agent:mail", prompt: "draft an email to bob about lunch", kind: "agent" },
  { id: "agent:imessage", prompt: "text jane that I'm running late", kind: "agent" },
  { id: "agent:search", prompt: "search the web for the capital of australia", kind: "ir" },
  { id: "agent:weather", prompt: "what's the weather in tokyo", kind: "ir" },

  { id: "agent:note-todo", prompt: "Create a note from my todo", kind: "agent" },
  { id: "agent:notes", prompt: "save this in my notes", kind: "agent" },
  { id: "agent:note-lunch", prompt: "add a note about lunch", kind: "agent" },
  { id: "agent:this", prompt: "save this", kind: "agent" },

  { id: "agent:math", prompt: "what is 2 plus 2", kind: "ir" },
  { id: "agent:joke", prompt: "tell me a joke", kind: "agent" },
  { id: "agent:greeting", prompt: "hey there", kind: "agent" },
];

/**
 * SSE -> refresh filter
 */

export type SseCase = {
  id: string;
  event: string;
  active: DocFilter | null;
  expect: string[] | null;
};

export const SSE_CASES: SseCase[] = [  { id: "sse:todo-new", event: "todo-created", active: null, expect: ["todo"] },
  { id: "sse:todo-update", event: "todo-updated", active: null, expect: ["todo"] },
  { id: "sse:todo-delete", event: "todo-deleted", active: null, expect: ["todo"] },
  { id: "sse:journal-new", event: "journal-created", active: null, expect: ["journal"] },
  { id: "sse:journal-text", event: "journal-text", active: null, expect: ["journal"] },
  { id: "sse:conversation-new", event: "new-conversation", active: null, expect: ["conversation"] },
  { id: "sse:conversation-update", event: "update-conversation", active: null, expect: ["conversation"] },
  {
    id: "sse:conversation-summary",
    event: "update-conversation-summary",
    active: null,
    expect: ["conversation"],
  },
  { id: "sse:conversation-delete", event: "delete-conversation", active: null, expect: ["conversation"] },
  { id: "sse:journal-update", event: "journal-updated", active: null, expect: ["journal"] },
  { id: "sse:journal-delete", event: "journal-deleted", active: null, expect: ["journal"] },
  { id: "sse:utterance", event: "new-utterance", active: null, expect: ["conversation"] },
  { id: "sse:location", event: "update-location", active: null, expect: ["location"] },
  { id: "sse:keep-filter", event: "todo-created", active: { kinds: ["todo"] }, expect: ["todo"] },
  {
    id: "sse:keep-multi",
    event: "update-conversation",
    active: { kinds: ["conversation", "todo"] },
    expect: ["conversation", "todo"],
  },
  { id: "sse:ignore-other", event: "todo-created", active: { kinds: ["fact"] }, expect: null },
  { id: "sse:ignore-connected", event: "connected", active: null, expect: null },
  { id: "sse:ignore-unknown", event: "bogus-event", active: null, expect: null },
];

export type WatchLineCase = { id: string; line: string; expect: string | null };

export const WATCH_LINE_CASES: WatchLineCase[] = [
  { id: "watch-line:todo", line: '{"event":"todo-created","data":{"todo":{"id":1}}}', expect: "todo-created" },
  { id: "watch-line:connected", line: '{"event":"connected","data":{}}', expect: "connected" },
  { id: "watch-line:bad-json", line: "not json", expect: null },
  { id: "watch-line:no-event", line: '{"data":{}}', expect: null },
  { id: "watch-line:blank", line: "   ", expect: null },
];
