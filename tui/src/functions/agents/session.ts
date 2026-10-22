import type { SessionItem, SessionResult, SessionState } from "./types";

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
      kind: KIND_BY_TOOL[tool] ?? fallbackKind,
      ...(createdAtOf(record) !== undefined ? { createdAt: createdAtOf(record) } : {}),
      record,
    });
  }
  if (items.length === 0) return session.lastResult;
  const result: SessionResult = {
    kind: KIND_BY_TOOL[tool] ?? fallbackKind ?? "item",
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
  if (items.length === 0) return session.lastEntity;
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
  if (/\b(?:newest|latest|last)\b/.test(lower)) {
    return [...items].sort((a, b) => (b.createdAt ?? b.index) - (a.createdAt ?? a.index))[0];
  }
  return session.lastEntity ?? items[0];
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
