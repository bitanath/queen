import type { SessionItem, SessionReference, SessionResult, SessionState } from "./types";

const RESULT_KEYS = ["results", "todos", "facts", "conversations", "daily_summaries", "insights", "voice_notes", "visits", "photos", "transcript"];

const KIND_BY_TOOL: Record<string, string> = {
  bee_list_todos: "todo",
  bee_get_todo_suggestions: "todo",
  bee_list_facts: "fact",
  bee_search_facts: "fact",
  bee_get_fact: "fact",
  bee_list_conversations: "conversation",
  bee_search: "conversation",
  bee_get_conversation: "conversation",
  bee_get_conversation_transcript: "conversation",
  bee_get_related_conversations: "conversation",
  bee_list_daily_summaries: "daily",
  bee_get_daily_summary: "daily",
  bee_get_insights: "insight",
  bee_get_insight: "insight",
  bee_list_voice_notes: "journal",
  bee_search_voice_notes: "journal",
  bee_get_voice_note: "journal",
  bee_get_location_clusters: "location",
  bee_get_recent_visits: "location",
  bee_get_current_location: "location",
  bee_get_photos: "photo",
  bee_get_photo: "photo",
  bee_list_external_access: "external",
  bee_get_recent_activity: "activity",
  bee_get_today: "today",
  bee_status: "status",
  bee_me: "profile",
};

const KIND_ALIASES: Record<string, string> = {
  conversation: "conversation",
  conversations: "conversation",
  transcript: "conversation",
  transcripts: "conversation",
  fact: "fact",
  facts: "fact",
  daily_summary: "daily",
  "daily-summary": "daily",
  daily: "daily",
  insight: "insight",
  insights: "insight",
  journal: "journal",
  journals: "journal",
  voice_note: "journal",
  "voice-note": "journal",
  voice_notes: "journal",
  todo: "todo",
  todos: "todo",
  task: "todo",
  tasks: "todo",
  photo: "photo",
  photos: "photo",
  location: "location",
  locations: "location",
  visit: "location",
  visits: "location",
};

function kindOfRecord(record: Record<string, unknown>, fallback?: string): string | undefined {
  const type = record["type"];
  if (typeof type === "string") {
    const alias = KIND_ALIASES[type.toLowerCase()];
    if (alias) return alias;
  }
  return fallback;
}

function textOf(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return textOf(parsed);
    } catch {
      return value;
    }
    return value;
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (record["toolResult"] !== undefined) return textOf(record["toolResult"]);
  if (Array.isArray(record["content"])) {
    return record["content"].map((item) => textOf(item)).filter((item) => item.length > 0).join("\n");
  }
  if (typeof record["text"] === "string") return textOf(record["text"]);
  if (record["json"] !== undefined) return textOf(record["json"]);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function createdAtOf(item: Record<string, unknown>): number | undefined {
  for (const key of ["created_at", "started_at", "date_time", "spoken_at", "start"]) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function titleOf(item: Record<string, unknown>): string {
  for (const key of ["text", "title", "short_summary", "summary", "detailed_summary", "name", "address"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 160);
  }
  return "";
}

function collectItems(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") out.push(item as Record<string, unknown>);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of RESULT_KEYS) {
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object") out.push(item as Record<string, unknown>);
      }
    }
  }
}

export function createSession(doc?: {
  kind: string;
  id: string | number;
  title?: string;
  summary?: string;
}): SessionState {
  return doc ? { activeDoc: doc } : {};
}

export function rememberResult(
  session: SessionState,
  tool: string,
  raw: unknown,
  fallbackKind?: string,
): SessionResult | undefined {
  const text = textOf(raw);
  const payload = parsePayload(text.length > 0 ? text : raw);
  const records: Record<string, unknown>[] = [];
  collectItems(payload, records);
  const fallback = KIND_BY_TOOL[tool] ?? fallbackKind;
  const items: SessionItem[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const id = record["id"];
    const title = titleOf(record);
    if ((typeof id !== "number" && typeof id !== "string") || title.length === 0) continue;
    const key = `${String(id)}\u0000${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id,
      title,
      index: items.length,
      kind: kindOfRecord(record, fallback),
      ...(createdAtOf(record) !== undefined ? { createdAt: createdAtOf(record) } : {}),
      record,
    });
  }
  if (items.length === 0) return session.lastResult;
  const result: SessionResult = {
    kind: items[0]?.kind ?? fallback ?? "item",
    items,
    ...(text.length > 0 ? { text: text.slice(0, 4000) } : {}),
  };
  session.lastResult = result;
  session.lastEntity = items[0];
  return result;
}

export function rememberRecords(
  session: SessionState,
  kind: string,
  records: Record<string, unknown>[],
  text?: string,
): SessionResult {
  const items: SessionItem[] = records.map((record, index) => ({
    id: typeof record["id"] === "string" || typeof record["id"] === "number" ? record["id"] : index,
    title: titleOf(record) || `item ${index + 1}`,
    index,
    kind,
    ...(createdAtOf(record) !== undefined ? { createdAt: createdAtOf(record) } : {}),
    record,
  }));
  const result: SessionResult = {
    kind,
    items,
    ...(text ? { text } : {}),
  };
  session.lastResult = result;
  session.lastEntity = items[0];
  return result;
}

export function rememberAction(
  session: SessionState,
  tool: string,
  args: Record<string, unknown>,
): void {
  session.lastAction = { tool, args };
  if (tool === "bee_delete_todo" || tool === "bee_delete_fact") {
    const id = args["id"];
    if (session.lastResult) {
      session.lastResult.items = session.lastResult.items.filter((item) => item.id !== id);
    }
    if (session.lastEntity?.id === id) session.lastEntity = undefined;
  }
}

export function rememberReference(
  session: SessionState,
  kind: string,
  record: Record<string, unknown>,
  text?: string,
): SessionItem | undefined {
  const id = record["id"];
  if (typeof id !== "number" && typeof id !== "string") return undefined;
  const item: SessionItem = {
    id,
    title: titleOf(record) || kind,
    index: 0,
    kind,
    ...(createdAtOf(record) !== undefined ? { createdAt: createdAtOf(record) } : {}),
    record,
  };
  const existing = session.lastResult?.items.find(
    (candidate) => String(candidate.id) === String(id) && candidate.kind === kind,
  );
  if (existing) {
    existing.title = item.title;
    if (item.createdAt !== undefined) existing.createdAt = item.createdAt;
    existing.record = record;
    item.index = existing.index;
  }
  session.lastEntity = item;
  if (!session.lastResult) {
    session.lastResult = { kind, items: [item], ...(text ? { text: text.slice(0, 4000) } : {}) };
  }
  return item;
}

export function setPendingClarification(
  session: SessionState,
  prompt: string,
  original: string,
  options?: string[],
): void {
  session.pendingClarification = { prompt, original, ...(options ? { options } : {}) };
}

export function clearPendingClarification(session: SessionState): void {
  session.pendingClarification = undefined;
}

export function resolveReference(session: SessionState, text: string): SessionItem | undefined {
  const items = session.lastResult?.items ?? [];
  if (items.length === 0) {
    if (session.lastEntity) return session.lastEntity;
    if (session.activeDoc) {
      return {
        id: session.activeDoc.id,
        title: session.activeDoc.title ?? "",
        index: 0,
        kind: session.activeDoc.kind,
      };
    }
    return undefined;
  }
  const lower = text.toLowerCase();
  const ordinal =
    /\b(?:the\s+)?first\b/.test(lower) ? 0 :
    /\b(?:the\s+)?second\b/.test(lower) ? 1 :
    /\b(?:the\s+)?third\b/.test(lower) ? 2 :
    undefined;
  if (ordinal !== undefined) return items[ordinal];
  if (/\b(?:oldest|earliest)\b/.test(lower)) {
    return [...items].sort((a, b) => (a.createdAt ?? a.index) - (b.createdAt ?? b.index))[0];
  }
  if (/\b(?:newest|latest|last|most recent)\b/.test(lower)) {
    return [...items].sort((a, b) => (b.createdAt ?? b.index) - (a.createdAt ?? a.index))[0];
  }
  return session.lastEntity ?? items[0];
}

const URI_KIND: Record<string, string> = {
  conversations: "conversation",
  todos: "todo",
  facts: "fact",
  daily: "daily",
  journals: "journal",
  insights: "insight",
  photos: "photo",
  locations: "location",
};

export type ResolvedReference = SessionReference;

export const REFERENCE_READ_TOOLS: Record<string, string> = {
  conversation: "bee_get_conversation",
  fact: "bee_get_fact",
  daily: "bee_get_daily_summary",
  insight: "bee_get_insight",
  journal: "bee_get_voice_note",
};

export function referenceReadTool(kind: string | undefined): string | undefined {
  return kind ? REFERENCE_READ_TOOLS[kind] : undefined;
}

const REFERENCE_STOP = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by",
  "about", "into", "over", "after", "before", "this", "that", "these", "those", "it", "them", "its",
  "me", "my", "mine", "i", "you", "your", "we", "our", "us", "he", "she", "they", "his", "her", "their",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must", "please", "tell", "show",
  "give", "get", "read", "fetch", "find", "search", "look", "up", "more", "gist", "summary", "summaries",
  "detail", "details", "what", "which", "who", "whom", "when", "where", "why", "how", "say", "said",
  "talk", "talked", "discuss", "discussed", "mention", "mentioned", "hear", "heard", "conversation",
  "conversations", "transcript", "transcripts", "chat", "chats", "note", "notes", "voice", "journal",
  "journals", "fact", "facts", "todo", "todos", "task", "tasks", "daily", "insight", "insights",
  "latest", "last", "newest", "oldest", "first", "second", "third", "next", "previous", "one", "ones",
  "thing", "things", "item", "items", "bee", "request", "like", "just", "now",
]);

function normalizeReference(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function significantReferenceTokens(value: string): string[] {
  return normalizeReference(value)
    .split(" ")
    .filter((word) => word.length > 2 && !REFERENCE_STOP.has(word));
}

function tokenMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function titleScore(title: string, requestWords: string[]): number | undefined {
  const titleWords = significantReferenceTokens(title);
  if (titleWords.length === 0) return undefined;
  let matched = 0;
  for (const word of titleWords) {
    if (requestWords.some((candidate) => tokenMatch(word, candidate))) matched += 1;
  }
  if (matched === 0) return undefined;
  const distinctive = matched >= 2 || titleWords.length === 1;
  if (!distinctive) return undefined;
  const titleCoverage = matched / titleWords.length;
  const requestCoverage = matched / Math.max(1, requestWords.length);
  return matched * 4 + titleCoverage * 2 + requestCoverage;
}

function matchTitle(items: SessionItem[], text: string): SessionItem | undefined {
  const normalized = normalizeReference(text);
  const exact = items.find((candidate) => {
    const title = normalizeReference(candidate.title);
    return title.length > 2 && normalized.includes(title);
  });
  if (exact) return exact;

  const requestWords = significantReferenceTokens(text);
  if (requestWords.length === 0) return undefined;
  let best: { item: SessionItem; score: number; recency: number } | undefined;
  for (const item of items) {
    const score = titleScore(item.title, requestWords);
    if (score === undefined) continue;
    const recency = item.createdAt ?? -item.index;
    if (!best || score > best.score || (score === best.score && recency > best.recency)) {
      best = { item, score, recency };
    }
  }
  return best?.item;
}

function referenceCandidates(session: SessionState): SessionItem[] {
  const items = session.lastResult?.items ?? [];
  const last = session.lastEntity;
  if (!last) return items;
  if (items.some((item) => String(item.id) === String(last.id) && item.kind === last.kind)) return items;
  return [...items, last];
}

/** Resolve a title, Bee URI, ordinal, or pronoun from the last result. */
export function resolveRequestedReference(
  session: SessionState,
  text: string,
): ResolvedReference | undefined {
  const items = referenceCandidates(session);
  const uri = /\bbee:\/\/([a-z-]+)\/([^\s?#]+)/i.exec(text);
  if (uri) {
    const id = decodeURIComponent(uri[2] ?? "");
    const item = items.find((candidate) => String(candidate.id) === id);
    const kind = item?.kind ?? URI_KIND[uri[1]?.toLowerCase() ?? ""];
    if (id.length > 0 && (item || kind)) {
      return {
        ...(item ? { item } : {}),
        ...(kind ? { kind } : {}),
        id: item?.id ?? id,
        ...(item?.title ? { title: item.title } : {}),
        source: "uri",
      };
    }
  }

  const item = matchTitle(items, text);
  if (item) {
    return {
      item,
      ...(item.kind ? { kind: item.kind } : {}),
      id: item.id,
      title: item.title,
      source: "title",
    };
  }

  if (/\b(?:this|that|these|those|it|them|first|second|third|last|latest|oldest|newest|most recent)\b/i.test(text)) {
    const resolved = resolveReference(session, text);
    if (resolved) {
      return {
        item: resolved,
        ...(resolved.kind ? { kind: resolved.kind } : {}),
        id: resolved.id,
        ...(resolved.title ? { title: resolved.title } : {}),
        source: /\b(?:first|second|third)\b/i.test(text) ? "ordinal" : "pronoun",
      };
    }
  }
  return undefined;
}

export function referenceLine(reference: ResolvedReference): string {
  const title = reference.title ? ` title=${JSON.stringify(reference.title)}` : "";
  const line = `Resolved reference: ${reference.kind ?? "item"} id=${String(reference.id)}${title}`;
  const tool = referenceReadTool(reference.kind);
  if (!tool) return line;
  return `${line}\nFetch this ${reference.kind} with ${tool} using id=${String(reference.id)}. Do not answer "done".`;
}

export function formatSession(session: SessionState): string {
  const lines: string[] = [];
  if (session.activeDoc) {
    lines.push(
      `Active document: ${session.activeDoc.kind} ${String(session.activeDoc.id)}${session.activeDoc.title ? ` — ${session.activeDoc.title}` : ""}`,
    );
    if (session.activeDoc.summary) lines.push(`Document context: ${session.activeDoc.summary.slice(0, 1200)}`);
  }
  if (session.pendingClarification) {
    lines.push(`Pending clarification: ${session.pendingClarification.prompt}`);
    lines.push(`Original request: ${session.pendingClarification.original}`);
  }
  if (session.lastResult) {
    lines.push(`Last result: ${session.lastResult.kind}`);
    for (const item of session.lastResult.items.slice(0, 12)) {
      lines.push(`  ${item.index + 1}. id=${String(item.id)} ${item.title}`);
    }
  }
  if (session.lastAction) {
    lines.push(`Last action: ${session.lastAction.tool} ${JSON.stringify(session.lastAction.args)}`);
  }
  return lines.join("\n");
}
