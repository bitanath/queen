import { hostAgentName } from "../automation";

const host = hostAgentName();
const hostLine =
  host === "linux"
    ? "- linux: actions on this Linux machine — open URLs, clipboard, notifications, files, system status."
    : "- mac: actions on this Mac — reminders, calendar events, maps, notes, contacts, mail, messages, music, clipboard, notifications, Finder, Shortcuts, dark mode, system status.";

export const orchestratorPrompt = `
You are Queen, a concise assistant. You have three agent roles: bee, mac and linux. On this machine only bee and ${host ?? "the host agent"} are available.
- bee: the user's own captured data — conversations, daily summaries, facts, todos, insights, journals, locations, activity, profile, search.
${hostLine}

Routing examples:
- "what did I talk about yesterday" -> bee
- "list my saved facts" -> bee
- "search for voice recorder" -> bee
- "add a reminder to call mum" -> ${host ?? "the host agent"}
- "remind me to call mum tomorrow at 9" -> ${host ?? "the host agent"}
- "show this address on the map" -> ${host ?? "the host agent"}
- "draft an email to bob" -> ${host ?? "the host agent"}
- "what's on the clipboard" -> ${host ?? "the host agent"}
- "open safari" -> ${host ?? "the host agent"}
- "I'm liking the weather today" -> answer directly, no tool

Rules: if the user wants something DONE on the machine, use the host agent; to search or recall anything, use bee. If a request is genuinely ambiguous between Bee data and a host action (e.g. "add a todo" could be a Bee todo or an Apple Reminder), call clarify to ask the user once, then act on their answer. Call one agent at most once, then answer in one or two sentences. Do not think out loud. Plain prose, English only, no code blocks.
`.trim();

export type RouteClass = "bee" | "mac" | "linux" | "ambiguous" | "none";

const QUESTION_WORDS =
  /^(what|whats|where|whens|who|whom|whose|why|hows|how|which|when|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)$/;


const IMPERATIVES = new Set([
  "list", "show", "find", "search", "get", "fetch", "tell", "give", "summarize", "summarise", "read",
  "add", "create", "make", "set", "save", "put", "log", "track", "remember", "note",
  "remind", "schedule", "plan", "draft", "send", "text", "message", "email", "mail", "call",
  "open", "launch", "reveal", "copy", "paste", "play", "pause", "skip", "toggle", "turn",
  "mark", "complete", "update", "edit", "delete", "remove", "run", "start", "stop",
  "translate", "check", "close", "quit", "review", "look",
]); //TODO: these verbs will start an actual action request


const HOST = [
  /\bremind(er|ers|ing)?\b/, /\bcalendar\b/, /\bmeeting\b/, /\bappointment\b/, /\bcontacts?\b/,
  /\bemails?\b/, /\bmail\b/, /\bimessages?\b/, /\bsms\b/, /\btext\b/, /\bdirections?\b/, /\bnavigate\b/,
  /\bmaps?\b/, /\bmusic\b/, /\bsong\b/, /\bplay\b/, /\bpause\b/, /\bclipboard\b/, /\bpaste\b/,
  /\bnotif(y|ication|ications)\b/, /\bfinder\b/, /\breveal\b/, /\bshortcut\b/, /\bdark mode\b/,
  /\bbattery\b/, /\bscreenshot\b/, /\bvolume\b/, /\bbrightness\b/, /\blaunch\b/, /\bsiri\b/, /\bopen\b/,
];

const BEE = [
  /\bconversations?\b/, /\btranscripts?\b/, /\butterances?\b/, /\bsummar(y|ies)\b/, /\bdail(y|ies)\b/,
  /\bfacts?\b/, /\binsights?\b/, /\bjournals?\b/, /\bvoice ?notes?\b/, /\blocation clusters?\b/,
  /\bvisits?\b/, /\bphotos?\b/, /\bactivity\b/, /\bprofile\b/, /\bwearable\b/, /\bbee\b/,
  /\bwhere have i been\b/, /\bwhere am i\b/, /\bbeen up to\b/, /\bwhat did i (say|hear|talk|do)\b/,
  /\btoday'?s brief\b/, /\bbrief\b/, /\bsearch my\b/, /\bmy data\b/,
  /\b(am i logged in|logged in|login status|connection status|reachable)\b/,
];

const AMBIGUOUS_OBJECT = [/todos?/, /\btasks?\b/, /\bnotes?\b/, /\blists?\b/, /\breminders?\b/, /\bideas?\b/]; //FIXME: is it a Bee? is it a Mac? Nobody knows these tings

const WRITE_VERB = /\b(add|create|make|set|save|put|log|track|remember|draft|write|update|edit|delete|remove|mark|complete|new)\b/;

const SEARCH = /^search\b/;

function norm(text: string): string {
  return text.toLowerCase().replace(/[\u2019']/g, "");
}

export function isRequest(text: string): boolean {
  const t = norm(text).trim();
  if (t.includes("?")) return true;
  const first = t.split(/[\s,]+/)[0] ?? "";
  if (QUESTION_WORDS.test(first)) return true;
  return IMPERATIVES.has(first) || IMPERATIVES.has(first.replace(/s$/, ""));
}

function any(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function classifyRequest(text: string, docKind?: string | null): RouteClass {
  if (!isRequest(text)) return "none";

  const t = norm(text);
  if (SEARCH.test(t)) return "bee";
  const hostAgent = any(t, HOST);
  const bee = any(t, BEE);
  const ambiguousObject = any(t, AMBIGUOUS_OBJECT);
  const write = WRITE_VERB.test(t);
  const deictic = /\b(this|that|it|these|those)\b/.test(t);

  if (hostAgent && bee) return "ambiguous";
  if (hostAgent) return hostAgentName() ?? "none";
  if (bee) return "bee";

  if (ambiguousObject && deictic && docKind) return "bee";
  if (ambiguousObject) return write ? "ambiguous" : "bee";
  if (deictic && docKind) return "bee";
  return "none";
}

export type RoutePlan =
  | { kind: "direct" }
  | { kind: "clarify" }
  | { kind: "worker"; worker: "bee" | "mac" | "linux" };


export function planRoute(text: string, docKind?: string | null): RoutePlan {
  const cls = classifyRequest(text, docKind);
  if (cls === "none") return { kind: "direct" };
  if (cls === "ambiguous") return { kind: "clarify" };
  return { kind: "worker", worker: cls };
}
