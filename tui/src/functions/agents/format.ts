import { humanDate } from "../../utils/bee-com-bridge";

export type CollectionKind = | "conversation" | "todo" | "fact" | "daily" | "insight" | "journal" | "photo" | "location" | "activity" | "external" | "suggestion";

const URI_KIND: Partial<Record<CollectionKind, string>> = {
  conversation: "conversations",
  todo: "todos",
  suggestion: "todos",
  fact: "facts",
  daily: "daily",
  insight: "insights",
  journal: "journals",
  photo: "photos",
};

const RECORD_URI: Record<string, string> = {
  conversation: "conversations",
  conversations: "conversations",
  todo: "todos",
  todos: "todos",
  fact: "facts",
  facts: "facts",
  daily: "daily",
  "daily-summary": "daily",
  insight: "insights",
  insights: "insights",
  journal: "journals",
  journals: "journals",
  "voice-note": "journals",
  "voice-note-journal": "journals",
  photo: "photos",
  photos: "photos",
};

export function beeUri(kind: string | undefined, id: unknown): string | undefined {
  if (id === undefined || id === null) return undefined;
  const resource = kind ? URI_KIND[kind as CollectionKind] ?? RECORD_URI[kind.toLowerCase()] : undefined;
  return resource ? `bee://${resource}/${encodeURIComponent(String(id))}` : undefined;
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function timestampOf(record: Record<string, unknown>, kind?: string): number | undefined {
  const keys =
    kind === "conversation" ? ["started_at", "start_time", "created_at"] :
    kind === "daily" ? ["date_time", "date"] :
    kind === "location" ? ["start", "started_at", "created_at"] :
    ["created_at", "started_at", "start_time", "date_time", "date", "spoken_at"];
  for (const key of keys) {
    const value = record[key];
    const numeric = number(value);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

export function titleOf(record: Record<string, unknown>, kind?: string): string {
  const keys =
    kind === "conversation" ? ["short_summary", "summary", "detailed_summary", "title", "text"] :
    kind === "todo" ? ["text", "title"] :
    kind === "fact" ? ["text", "title"] :
    kind === "daily" ? ["short_summary", "summary", "text"] :
    kind === "insight" ? ["text", "summary", "title"] :
    kind === "journal" ? ["text", "summary", "title"] :
    kind === "location" ? ["address", "name", "query", "text"] :
    ["text", "summary", "short_summary", "detailed_summary", "title", "name", "address"];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function uriOf(kind: string | undefined, record: Record<string, unknown>): string {
  return beeUri(kind, record["id"]) ?? "—";
}

function table(columns: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  return [header, divider, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function rowFor(kind: CollectionKind, record: Record<string, unknown>): string[] {
  const when = humanDate(record["started_at"] ?? record["start_time"] ?? record["created_at"] ?? record["date_time"] ?? record["date"] ?? record["start"]);
  switch (kind) {
    case "conversation":
      return [when, cell(titleOf(record, "conversation")), cell(uriOf("conversation", record))];
    case "todo":
      return [cell(titleOf(record, "todo")), when, cell(uriOf("todo", record))];
    case "suggestion":
      return [cell(titleOf(record, "todo")), when, cell(uriOf("suggestion", record))];
    case "fact":
      return [cell(titleOf(record, "fact")), record["confirmed"] === true ? "yes" : "no", when, cell(uriOf("fact", record))];
    case "daily":
      return [when, cell(titleOf(record, "daily")), cell(uriOf("daily", record))];
    case "insight":
      return [cell(titleOf(record, "insight")), when, cell(uriOf("insight", record))];
    case "journal":
      return [when, cell(titleOf(record, "journal")), cell(uriOf("journal", record))];
    case "photo":
      return [when, cell(uriOf("photo", record))];
    case "location":
      return [when, cell(titleOf(record, "location")), cell(uriOf("location", record))];
    case "activity": {
      const recordKind = typeof record["type"] === "string" ? record["type"] : "item";
      return [recordKind, cell(titleOf(record)), when, cell(uriOf(recordKind, record))];
    }
    case "external":
      return [cell(record["service"] ?? record["name"] ?? record["app"]), when, "—"];
    default:
      return [cell(titleOf(record)), when, cell(uriOf(kind, record))];
  }
}

const COLUMNS: Record<CollectionKind, string[]> = {
  conversation: ["when", "summary", "uri"],
  todo: ["todo", "created", "uri"],
  suggestion: ["suggested todo", "created", "uri"],
  fact: ["fact", "confirmed", "created", "uri"],
  daily: ["date", "summary", "uri"],
  insight: ["insight", "created", "uri"],
  journal: ["when", "journal", "uri"],
  photo: ["when", "uri"],
  location: ["when", "place", "uri"],
  activity: ["kind", "item", "when", "uri"],
  external: ["service", "when", "uri"],
};

const RECORD_KEYS = [
  "results",
  "conversations",
  "todos",
  "facts",
  "daily_summaries",
  "insights",
  "voice_notes",
  "photos",
  "visits",
  "activity",
  "external_access",
  "suggestions",
  "items",
];

export function recordsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

export function listTable(kind: CollectionKind, records: Record<string, unknown>[]): string {
  return table(COLUMNS[kind], records.map((record) => rowFor(kind, record)));
}

export function searchTable(records: Record<string, unknown>[], fallbackKind?: string): string {
  const rows = records.map((record) => {
    const kind = typeof record["type"] === "string" ? record["type"] : fallbackKind ?? "item";
    const when = humanDate(record["started_at"] ?? record["created_at"] ?? record["date_time"] ?? record["date"]);
    return [when, kind, cell(titleOf(record, kind)), cell(uriOf(kind, record))];
  });
  return table(["when", "kind", "summary", "uri"], rows);
}

export function recordKind(record: Record<string, unknown>, fallback?: string): string {
  return typeof record["type"] === "string" ? record["type"] : fallback ?? "item";
}
