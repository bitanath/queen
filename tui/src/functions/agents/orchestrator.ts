// Orchestrator prompt + a deterministic routing heuristic.
//
// The orchestrator has NO capability tools — only the three workers. It is
// intentionally steered away from thinking out loud. A couple of few-shot
// examples keep small local models on the right agent.
//
// `classifyRequest` is a cheap pre-pass: it extracts intent (verb + object) and
// either picks the obvious worker or flags genuine ambiguity (e.g. "add a todo"
// could be a Bee todo or an Apple Reminder) so the orchestrator can ask once
// instead of guessing.

export const orchestratorPrompt = `
You are Queen, a concise assistant. You have exactly three agents; call the right one, then relay its result briefly.
- bee: the user's own captured data — conversations, daily summaries, facts, todos, insights, journals, locations, activity, profile.
- mac: actions on this computer — reminders, calendar events, maps, notes, contacts, mail, messages, music, clipboard, notifications, Finder, Shortcuts, dark mode, system status.
- net: the web — search, fetching pages, HTTP requests.

Routing examples:
- "what did I talk about yesterday" -> bee
- "list my saved facts" -> bee
- "add a reminder to call mum" -> mac
- "remind me to call mum tomorrow at 9" -> mac
- "show this address on the map" -> mac
- "give me directions to the airport" -> mac
- "draft an email to bob" -> mac
- "text jane that I'm running late" -> mac
- "what's on the clipboard" -> mac
- "open safari" -> mac
- "what's the weather in Tokyo" -> net
- "search the web for X" -> net
- "I'm liking the weather today" -> answer directly, no tool

Rules: if the user wants something DONE on the machine, use mac; to recall their memory, use bee; to look something up in the world, use net. If a request is genuinely ambiguous between Bee data and a host action (e.g. "add a todo" could be a Bee todo or an Apple Reminder), call clarify to ask the user once, then act on their answer. Call one agent at most once, then answer in one or two sentences. Do not think out loud. Plain prose, English only, no code blocks.
`.trim();

// ---------------------------------------------------------------------------
// Deterministic routing heuristic
// ---------------------------------------------------------------------------

export type RouteClass = "bee" | "mac" | "net" | "ambiguous" | "none";

/** Words that start a question-like request (incl. auxiliaries: "is bee reachable"). */
const QUESTION_WORDS =
  /^(what|whats|where|whens|who|whom|whose|why|hows|how|which|when|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)$/;

/** Imperative verbs that start a request. */
const IMPERATIVES = new Set([
  "list", "show", "find", "search", "get", "fetch", "tell", "give", "summarize", "summarise", "read",
  "add", "create", "make", "set", "save", "put", "log", "track", "remember", "note",
  "remind", "schedule", "plan", "draft", "send", "text", "message", "email", "mail", "call",
  "open", "launch", "reveal", "copy", "paste", "play", "pause", "skip", "toggle", "turn",
  "mark", "complete", "update", "edit", "delete", "remove", "run", "start", "stop",
  "translate", "check", "close", "quit",
]);

/** The web. */
const NET = [
  /\bweather\b/, /\bforecast\b/, /\bsearch (the )?web\b/, /\bweb search\b/, /\bgoogle\b/, /\bonline\b/,
  /\bwikipedia\b/, /\bnews\b/, /\bcapital of\b/, /\bhttps?:\/\//, /\bapi\b/, /\bfetch\b/, /\btranslate\b/,
  /\bstock price\b/, /\bexchange rate\b/, /\binternet\b/,
];

/** Host/mac actions (unambiguous verbs + Apple app nouns). */
const MAC = [
  /\bremind(er|ers|ing)?\b/, /\bcalendar\b/, /\bmeeting\b/, /\bappointment\b/, /\bcontacts?\b/,
  /\bemails?\b/, /\bmail\b/, /\bimessages?\b/, /\bsms\b/, /\btext\b/, /\bdirections?\b/, /\bnavigate\b/,
  /\bmaps?\b/, /\bmusic\b/, /\bsong\b/, /\bplay\b/, /\bpause\b/, /\bclipboard\b/, /\bpaste\b/,
  /\bnotif(y|ication|ications)\b/, /\bfinder\b/, /\breveal\b/, /\bshortcut\b/, /\bdark mode\b/,
  /\bbattery\b/, /\bscreenshot\b/, /\bvolume\b/, /\bbrightness\b/, /\blaunch\b/, /\bsiri\b/, /\bopen\b/,
];

/** Bee's captured data (unambiguous nouns). */
const BEE = [
  /\bconversations?\b/, /\btranscripts?\b/, /\butterances?\b/, /\bsummar(y|ies)\b/, /\bdail(y|ies)\b/,
  /\bfacts?\b/, /\binsights?\b/, /\bjournals?\b/, /\bvoice ?notes?\b/, /\blocation clusters?\b/,
  /\bvisits?\b/, /\bphotos?\b/, /\bactivity\b/, /\bprofile\b/, /\bwearable\b/, /\bbee\b/,
  /\bwhere have i been\b/, /\bwhere am i\b/, /\bbeen up to\b/, /\bwhat did i (say|hear|talk|do)\b/,
  /\btoday'?s brief\b/, /\bbrief\b/, /\bsearch my\b/, /\bmy data\b/,
];

/** Objects that exist in both worlds — ambiguous without a strong signal. */
const AMBIGUOUS_OBJECT = [/todos?/, /\btasks?\b/, /\bnotes?\b/, /\blists?\b/, /\breminders?\b/, /\bideas?\b/];

/** Write verbs — with an ambiguous object these mean "ask once". */
const WRITE_VERB = /\b(add|create|make|set|save|put|log|track|remember|draft|write|update|edit|delete|remove|mark|complete|new)\b/;

/** Verbs that genuinely mean the web. */
const NET_VERB = /\b(search|google|look up|fetch|browse)\b/;

function norm(text: string): string {
  return text.toLowerCase().replace(/[\u2019']/g, "");
}

/** True when the utterance asks for something (question or imperative), not a statement. */
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

/**
 * Classify a request into the worker it should go to, `"ambiguous"` (ask the
 * user once — e.g. a Bee todo vs an Apple Reminder), or `"none"` (answer
 * directly; chit-chat, opinions, or general knowledge).
 *
 * `docKind` is the open Bee document's kind, when there is one: a deictic like
 * "this"/"that"/"it" then resolves to bee.
 */
export function classifyRequest(text: string, docKind?: string | null): RouteClass {
  if (!isRequest(text)) return "none";

  const t = norm(text);
  const net = any(t, NET) || (NET_VERB.test(t) && /\b(web|online|internet)\b/.test(t));
  const mac = any(t, MAC);
  const bee = any(t, BEE);
  const ambiguousObject = any(t, AMBIGUOUS_OBJECT);
  const write = WRITE_VERB.test(t);
  const deictic = /\b(this|that|it|these|those)\b/.test(t);

  if (net && !mac && !bee) return "net";
  if (mac && bee) return "ambiguous";
  if (mac) return "mac";
  if (bee) return "bee";

  // The open document is Bee data: "mark this complete" on an open todo -> bee.
  if (ambiguousObject && deictic && docKind) return "bee";
  if (ambiguousObject) return write ? "ambiguous" : "bee";
  if (deictic && docKind) return "bee";
  return "none";
}

/** One-line hidden hint injected into the orchestrator prompt, or "" when obvious. */
export function routeHint(text: string, docKind?: string | null): string {
  const cls = classifyRequest(text, docKind);
  switch (cls) {
    case "bee":
      return "HINT: likely the user's own Bee data — prefer the bee agent.";
    case "mac":
      return "HINT: likely a host/OS action — prefer the mac agent.";
    case "net":
      return "HINT: likely about the web — prefer the net agent.";
    case "ambiguous":
      return "HINT: ambiguous between the user's Bee data and a host action — call clarify to ask which, once.";
    default:
      return "";
  }
}

/** The per-turn prompt with the hint prepended (keeps the system prefix cached). */
export function withRouteHint(question: string, docKind?: string | null): string {
  const hint = routeHint(question, docKind);
  return hint ? `${hint}\n\n${question}` : question;
}
