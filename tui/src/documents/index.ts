import { callBeeTextTool } from "@/commands/mcpToolOutput";

import { clockLabel, dayLabel, resolveTimeZone } from "../functions/analytics/time";
import { TOPIC_LEXICONS } from "../functions/analytics/lexicons";
import { countIn, tokens } from "../functions/analytics/text";
import type { TopicKey } from "../functions/analytics/types";
import { beeContext } from "../utils/bee-com-bridge";

export type DocumentKind = "conversation" | "daily" | "journal" | "fact" | "todo" | "insight" | "location";

export const DOCUMENT_KINDS: DocumentKind[] = [
  "conversation",
  "daily",
  "journal",
  "fact",
  "todo",
  "insight",
  "location",
];

export type DocumentMeta = { key: string; value: string };

export type QueenDocument = {
  key: string;
  kind: DocumentKind;
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  topic: TopicKey | null;
  markdown: string;
  body: string;
  summary: string;
  transcript: string;
  transcriptLines: TranscriptLine[];
  meta: DocumentMeta[];
};

export type RecentDocumentsOptions = {
  kinds?: DocumentKind[];
  limit?: number;
};

type DocFields = Omit<QueenDocument, "key" | "kind" | "id">;

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : {};
}

function unwrap(value: unknown): Rec {
  const record = asRecord(value);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object" && !Array.isArray(child)) return child as Rec;
  }
  return record;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function oneLine(value: string, max = 120): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}


const TOPIC_LABELS: Record<TopicKey, string> = {
  travel: "Travel",
  work: "Work",
  social: "Social",
  food: "Food",
  health: "Health",
  medical: "Medical",
  tech: "Tech",
  beauty: "Beauty",
  home: "Home",
  shopping: "Shopping",
  money: "Money",
  music: "Music",
  sport: "Sport",
  reading: "Reading",
  transport: "Transport",
  study: "Study",
  pets: "Pets",
  weather: "Weather",
  nature: "Nature",
};

const TOPIC_EMOJI: Record<TopicKey, string> = {
  travel: "✈️",
  work: "💼",
  social: "💬",
  food: "🍎",
  health: "💪",
  medical: "💊",
  tech: "💻",
  beauty: "💄",
  home: "🏠",
  shopping: "🛒",
  money: "💰",
  music: "🎵",
  sport: "🏃",
  reading: "📚",
  transport: "🚆",
  study: "🎓",
  pets: "🐾",
  weather: "☀️",
  nature: "🌿",
};

const FALLBACK_EMOJI = "📌";

export function topicMeta(key: TopicKey): { label: string; emoji: string } {
  return { label: TOPIC_LABELS[key], emoji: TOPIC_EMOJI[key] };
}

function topicOf(body: string): { key: TopicKey | null; label: string; emoji: string } {
  const list = tokens(body);
  let best: TopicKey | undefined;
  let bestScore = 0;
  for (const key of Object.keys(TOPIC_LEXICONS) as TopicKey[]) {
    const score = countIn(list, TOPIC_LEXICONS[key]);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best
    ? { key: best, label: TOPIC_LABELS[best], emoji: TOPIC_EMOJI[best] }
    : { key: null, label: "", emoji: FALLBACK_EMOJI };
}

function timeZoneOf(root: unknown): string {
  const tz = asRecord(root)["timezone"];
  return resolveTimeZone(typeof tz === "string" ? tz : undefined);
}

function whenLabel(ms: number | undefined, tz: string): string {
  if (ms === undefined) return "unknown";
  return `${dayLabel(ms, tz)} · ${clockLabel(ms, tz)}`;
}

function dayOnly(ms: number | undefined, tz: string, fallback: string): string {
  return ms === undefined ? fallback : dayLabel(ms, tz);
}

function listRecords(value: unknown, keys: string[]): unknown[] {
  const record = asRecord(value);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) return child;
  }
  return [];
}

export type TranscriptLine = {
  speaker: string;
  text: string;
  at?: number;
  end?: number;
  time?: string;
};

function transcriptLines(record: Rec, tz: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const transcriptions = record["transcriptions"];
  if (!Array.isArray(transcriptions)) return lines;
  for (const item of transcriptions) {
    const utterances = asRecord(item)["utterances"];
    if (!Array.isArray(utterances)) continue;
    for (const raw of utterances) {
      const u = asRecord(raw);
      const body = text(u["text"]);
      if (!body) continue;
      const speaker = text(u["speaker"]) || "Speaker";
      const at = num(u["spoken_at"]) ?? num(u["start"]);
      lines.push({
        speaker,
        text: body,
        ...(at !== undefined ? { at, end: at, time: clockLabel(at, tz) } : {}),
      });
    }
  }
  return lines;
}

function conversationMarkdown(summary: Rec, detail: Rec, tz: string): DocFields {
  const start = num(detail["start_time"]) ?? num(summary["start_time"]);
  const end = num(detail["end_time"]) ?? num(summary["end_time"]);
  const short = text(detail["short_summary"]) || text(summary["short_summary"]);
  const long = text(detail["summary"]) || text(summary["summary"]);
  const device = text(detail["device_type"]) || text(summary["device_type"]);
  const state = text(detail["state"]) || text(summary["state"]);
  const transcript = transcriptLines(detail, tz);

  const title = `Conversation · ${whenLabel(start, tz)}`;
  const subtitle = oneLine(short || long || "Conversation capture");
  const meta: DocumentMeta[] = [
    { key: "when", value: whenLabel(start, tz) },
    ...(end !== undefined && start !== undefined
      ? [{ key: "duration", value: `${Math.max(1, Math.round((end - start) / 60_000))} min` }]
      : []),
    ...(device ? [{ key: "device", value: device }] : []),
    ...(state ? [{ key: "state", value: state }] : []),
    ...(transcript.length > 0 ? [{ key: "utterances", value: String(transcript.length) }] : []),
  ];

  const compact = [short, long].filter((line, index, all) => line && all.indexOf(line) === index);
  const summaryText = compact.join("\n\n");

  const transcriptParts: string[] = ["## Transcript", ""];
  if (transcript.length > 0) {
    for (const line of transcript) {
      const stamp = line.at !== undefined ? `${clockLabel(line.at, tz)} · ` : "";
      transcriptParts.push(`**${line.speaker}** ${stamp}`);
      transcriptParts.push(line.text, "");
    }
  } else {
    transcriptParts.push("_No transcript captured._");
  }
  const transcriptText = transcriptParts.join("\n").trim();

  const bodyParts: string[] = [];
  if (short) bodyParts.push(`**${oneLine(short, 180)}**`, "");
  if (long && long !== short) bodyParts.push(long, "");
  bodyParts.push("---", "");
  for (const item of meta) bodyParts.push(`- **${item.key}:** ${item.value}`);
  const body = bodyParts.join("\n").trim();

  return {
    markdown: `${body}\n\n${transcriptText}`.trim(),
    body,
    summary: summaryText,
    transcript: transcript.length > 0 ? transcriptText : "",
    transcriptLines: transcript,
    title,
    subtitle,
    emoji: "🗣️",
    topic: topicOf(summaryText || subtitle).key,
    meta,
  };
}

function buildDoc(fields: {
  title: string;
  emoji: string;
  topic?: TopicKey | null;
  summary: string;
  body?: string;
  heading?: string;
  meta?: DocumentMeta[];
}): DocFields {
  const meta = fields.meta ?? [];
  const parts: string[] = [];
  if (fields.heading) parts.push(`## ${fields.heading}`, "");
  const content = fields.body?.trim() ?? "";
  if (content) parts.push(content);
  if (meta.length > 0) {
    if (parts.length > 0) parts.push("", "---", "");
    for (const item of meta) parts.push(`- **${item.key}:** ${item.value}`);
  }
  const body = parts.join("\n").trim();
  return {
    title: fields.title,
    subtitle: oneLine(fields.summary || fields.title),
    emoji: fields.emoji,
    topic: fields.topic ?? null,
    markdown: body,
    body,
    summary: fields.summary,
    transcript: "",
    transcriptLines: [],
    meta,
  };
}

function renderDaily(r: Rec, tz: string): DocFields {
  const at = num(r["date_time"]);
  const short = text(r["short_summary"]);
  const long = text(r["summary"]);
  const summary = [short, long].filter((line, index, all) => line && all.indexOf(line) === index).join("\n\n");
  return buildDoc({
    title: `Daily · ${dayOnly(at, tz, "summary")}`,
    emoji: "📅",
    topic: topicOf(long || short).key,
    summary,
    body: long || short,
    meta: [{ key: "date", value: whenLabel(at, tz) }],
  });
}

function renderFact(r: Rec, tz: string): DocFields {
  const at = num(r["created_at"]);
  const body = text(r["text"]);
  const tags = Array.isArray(r["tags"]) ? (r["tags"] as unknown[]).map(String) : [];
  const { key: topic, emoji, label } = topicOf(body);
  return buildDoc({
    title: `Fact · ${dayOnly(at, tz, "saved")}`,
    emoji,
    topic,
    summary: body,
    heading: [emoji, label, "Fact"].filter(Boolean).join(" "),
    body,
    meta: [
      { key: "status", value: r["confirmed"] === true ? "confirmed" : "pending" },
      ...(at !== undefined ? [{ key: "created", value: whenLabel(at, tz) }] : []),
      ...(tags.length > 0 ? [{ key: "tags", value: tags.join(", ") }] : []),
    ],
  });
}

function renderTodo(r: Rec, tz: string): DocFields {
  const at = num(r["created_at"]);
  const body = text(r["text"]);
  const alarm = num(r["alarm_at"]);
  const { key: topic, emoji, label } = topicOf(body);
  return buildDoc({
    title: `Todo · ${dayOnly(at, tz, "task")}`,
    emoji,
    topic,
    summary: body,
    heading: [emoji, label, "Todo"].filter(Boolean).join(" "),
    body,
    meta: [
      { key: "status", value: r["completed"] === true ? "done" : "open" },
      ...(at !== undefined ? [{ key: "created", value: whenLabel(at, tz) }] : []),
      ...(alarm !== undefined ? [{ key: "alarm", value: whenLabel(alarm, tz) }] : []),
    ],
  });
}

function renderJournal(r: Rec, tz: string): DocFields {
  const at = num(r["created_at"]);
  const body = text(r["text"]);
  const state = text(r["state"]);
  return buildDoc({
    title: `Journal · ${dayOnly(at, tz, "voice note")}`,
    emoji: "🎙️",
    topic: topicOf(body || state).key,
    summary: body || state || "voice note",
    body: body || (state ? `_${state}_` : ""),
    meta: [
      ...(at !== undefined ? [{ key: "created", value: whenLabel(at, tz) }] : []),
      ...(state ? [{ key: "state", value: state }] : []),
    ],
  });
}

function renderInsight(r: Rec, tz: string): DocFields {
  const at = num(r["created_at"]) ?? num(r["observed_at"]) ?? num(r["date_time"]);
  const body = text(r["text"]) || text(r["summary"]) || text(r["title"]);
  const { key: topic, emoji, label } = topicOf(body);
  return buildDoc({
    title: `Insight · ${dayOnly(at, tz, "insight")}`,
    emoji,
    topic,
    summary: body,
    heading: [emoji, label, "Insight"].filter(Boolean).join(" "),
    body,
    meta: at !== undefined ? [{ key: "when", value: whenLabel(at, tz) }] : [],
  });
}

function renderLocation(r: Rec, tz: string): DocFields {
  const start = num(r["start"]) ?? num(r["start_time"]) ?? num(r["arrived_at"]) ?? num(r["date_time"]);
  const end = num(r["end"]) ?? num(r["end_time"]);
  const place = text(r["address"]) || text(r["name"]) || text(r["place"]) || text(r["label"]);
  return buildDoc({
    title: `Location · ${dayOnly(start, tz, "visit")}`,
    emoji: "📍",
    summary: place || "location visit",
    body: place,
    meta: [
      ...(start !== undefined ? [{ key: "when", value: whenLabel(start, tz) }] : []),
      ...(end !== undefined && start !== undefined
        ? [{ key: "duration", value: `${Math.max(1, Math.round((end - start) / 60_000))} min` }]
        : []),
    ],
  });
}

type KindSpec = {
  tool: string;
  keys: string[];
  args?: (limit: number) => Record<string, unknown>;
  recency: (r: Rec) => number | undefined;
  idOf?: (r: Rec) => string | undefined;
  render: (r: Rec, tz: string) => DocFields;
};

const KIND_SPECS: Record<DocumentKind, KindSpec> = {
  conversation: {
    tool: "bee_list_conversations",
    keys: ["conversations"],
    recency: (r) => num(r["start_time"]),
    render: (r, tz) => conversationMarkdown({}, r, tz),
  },
  daily: {
    tool: "bee_list_daily_summaries",
    keys: ["daily_summaries"],
    recency: (r) => num(r["date_time"]),
    render: renderDaily,
  },
  journal: {
    tool: "bee_list_voice_notes",
    keys: ["journals", "voice_notes"],
    recency: (r) => num(r["created_at"]),
    render: renderJournal,
  },
  fact: {
    tool: "bee_list_facts",
    keys: ["facts"],
    args: () => ({ includeUnconfirmed: true }),
    recency: (r) => num(r["created_at"]),
    render: renderFact,
  },
  todo: {
    tool: "bee_list_todos",
    keys: ["todos"],
    recency: (r) => num(r["created_at"]),
    render: renderTodo,
  },
  insight: {
    tool: "bee_get_insights",
    keys: ["insights"],
    recency: (r) => num(r["created_at"]) ?? num(r["observed_at"]),
    render: renderInsight,
  },
  location: {
    tool: "bee_get_recent_visits",
    keys: ["visits"],
    args: () => ({ from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }),
    recency: (r) => num(r["start"]) ?? num(r["start_time"]) ?? num(r["date_time"]),
    idOf: (r) => {
      const s = num(r["start"]) ?? num(r["start_time"]) ?? num(r["date_time"]);
      return s !== undefined ? String(s) : undefined;
    },
    render: renderLocation,
  },
};

function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as string[]).includes(value);
}


export async function loadRecentDocuments(options: RecentDocumentsOptions = {}): Promise<QueenDocument[]> {
  const limit = options.limit ?? 20;
  const kinds = options.kinds ?? DOCUMENT_KINDS;
  const ctx = await beeContext("prod");
  const dated: { doc: QueenDocument; recency: number }[] = [];

  for (const kind of kinds) {
    const spec = KIND_SPECS[kind];
    if (!spec) continue;
    let data: unknown;
    try {
      data = await callBeeTextTool(ctx, spec.tool, { ...(spec.args ? spec.args(limit) : {}), limit: Math.max(limit, 10) });
    } catch {
      continue;
    }
    const tz = timeZoneOf(data);
    for (const record of listRecords(data, spec.keys)) {
      const r = asRecord(record);
      const idStr = spec.idOf ? spec.idOf(r) : r["id"] != null ? String(r["id"]) : undefined;
      if (idStr === undefined || idStr.length === 0) continue;
      dated.push({
        doc: { ...spec.render(r, tz), key: `${kind}:${idStr}`, kind, id: idStr },
        recency: spec.recency(r) ?? 0,
      });
    }
  }

  return dated
    .sort((a, b) => b.recency - a.recency)
    .slice(0, limit)
    .map((entry) => entry.doc)
    .sort((a, b) => a.title.localeCompare(b.title));
}


export function placeholderDocument(title: string, markdown: string): QueenDocument {
  return {
    key: "placeholder",
    kind: "conversation",
    id: "placeholder",
    title,
    subtitle: "nothing to show yet",
    emoji: "📌",
    topic: null,
    markdown,
    body: markdown,
    summary: markdown,
    transcript: "",
    transcriptLines: [],
    meta: [],
  };
}

export async function fetchConversation(id: number | string): Promise<QueenDocument> {
  const ctx = await beeContext("prod");
  const numeric = Number(id);
  const fetched = await callBeeTextTool(ctx, "bee_get_conversation", {
    id: Number.isFinite(numeric) ? numeric : id,
    includeTranscript: true,
  });
  const detail = unwrap(fetched);
  const tz = timeZoneOf(detail);
  return {
    key: `conversation:${String(id)}`,
    kind: "conversation",
    id: String(id),
    ...conversationMarkdown({}, detail, tz),
  };
}

export async function fetchDocument(kind: DocumentKind, id: string | number): Promise<QueenDocument> {
  if (kind === "conversation") return fetchConversation(id);
  const spec = KIND_SPECS[kind];
  const ctx = await beeContext("prod");
  const data = await callBeeTextTool(ctx, spec.tool, { ...(spec.args ? spec.args(50) : {}), limit: 50 });
  const tz = timeZoneOf(data);
  const record = listRecords(data, spec.keys)
    .map(asRecord)
    .find((r) => (spec.idOf ? spec.idOf(r) : r["id"] != null ? String(r["id"]) : undefined) === String(id));
  if (!record) throw new Error(`No ${kind} with id ${id}.`);
  const idStr = String(id);
  return { ...spec.render(record, tz), key: `${kind}:${idStr}`, kind, id: idStr };
}

export async function resolveDocument(reference: string): Promise<QueenDocument> {
  const trimmed = reference.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const kind = trimmed.slice(0, colon);
    const id = trimmed.slice(colon + 1);
    if (isDocumentKind(kind)) return fetchDocument(kind, id);
  }
  return fetchConversation(trimmed);
}
