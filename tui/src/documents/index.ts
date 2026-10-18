//TODO: Bee records rendered as Markdown documents. The rest of Queen (chat, actions, sidebar) only ever sees one of these at a time.
import { callBeeTextTool } from "@/commands/mcpToolOutput";

import { clockLabel, dayLabel, resolveTimeZone } from "../functions/analytics/time";
import { beeContext } from "../utils/bee-com-bridge";

export type DocumentKind = "conversation" | "daily" | "journal" | "fact" | "todo" | "insight";

export type DocumentMeta = { key: string; value: string };

export type QueenDocument = {
  key: string;
  kind: DocumentKind;
  id: string;
  title: string;
  subtitle: string;
  markdown: string;
  /** Compact context sent on the first chat turn (summary only, no transcript). */
  summary: string;
  /** Full transcript markdown, loaded on demand by the chat's read_document tool. */
  transcript: string;
  meta: DocumentMeta[];
};

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

function listOf(value: unknown, key: string): unknown[] {
  const record = asRecord(value);
  return Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
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

function timeZoneOf(root: unknown): string {
  const tz = asRecord(root)["timezone"];
  return resolveTimeZone(typeof tz === "string" ? tz : undefined);
}

function whenLabel(ms: number | undefined, tz: string): string {
  if (ms === undefined) return "unknown";
  return `${dayLabel(ms, tz)} · ${clockLabel(ms, tz)}`;
}

type Utterance = { speaker: string; text: string; at?: number };

function transcriptLines(record: Rec): Utterance[] {
  const lines: Utterance[] = [];
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
      lines.push({ speaker, text: body, ...(at !== undefined ? { at } : {}) });
    }
  }
  return lines;
}

function conversationMarkdown(
  summary: Rec,
  detail: Rec,
  tz: string,
): { markdown: string; summary: string; transcript: string; title: string; subtitle: string; meta: DocumentMeta[] } {
  const start = num(detail["start_time"]) ?? num(summary["start_time"]);
  const end = num(detail["end_time"]) ?? num(summary["end_time"]);
  const short = text(detail["short_summary"]) || text(summary["short_summary"]);
  const long = text(detail["summary"]) || text(summary["summary"]);
  const device = text(detail["device_type"]) || text(summary["device_type"]);
  const state = text(detail["state"]) || text(summary["state"]);
  const transcript = transcriptLines(detail);

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

  // Compact context: the summary the user sees, without the transcript. This is
  // what the first chat turn sends; read_document fetches the transcript.
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

  const parts: string[] = [];
  if (short) parts.push(`**${oneLine(short, 180)}**`, "");
  if (long && long !== short) parts.push(long, "");
  parts.push("---", "");
  for (const item of meta) parts.push(`- **${item.key}:** ${item.value}`);
  parts.push("", transcriptText);
  return {
    markdown: parts.join("\n").trim(),
    summary: summaryText,
    transcript: transcriptText,
    title,
    subtitle,
    meta,
  };
}


export async function loadRecentConversations(limit = 5): Promise<QueenDocument[]> {
  const ctx = await beeContext("prod");
  const listed = await callBeeTextTool(ctx, "bee_list_conversations", { limit });
  const tz = timeZoneOf(listed);
  const summaries = listOf(listed, "conversations");

  const docs: QueenDocument[] = [];
  for (const raw of summaries) {
    const summary = asRecord(raw);
    const id = summary["id"];
    if (id === undefined || id === null) continue;
    let detail: Rec = {};
    try {
      const fetched = await callBeeTextTool(ctx, "bee_get_conversation", {
        id: typeof id === "number" ? id : Number(id),
        includeTranscript: true,
      });
      detail = unwrap(fetched);
    } catch {
      detail = {};
    }
    const rendered = conversationMarkdown(summary, detail, tz);
    docs.push({
      key: `conversation:${String(id)}`,
      kind: "conversation",
      id: String(id),
      ...rendered,
    });
  }
  return docs;
}

/** Friendly placeholder used when Bee is unavailable or no records exist. */
export function placeholderDocument(title: string, markdown: string): QueenDocument {
  return {
    key: "placeholder",
    kind: "conversation",
    id: "placeholder",
    title,
    subtitle: "nothing to show yet",
    markdown,
    summary: markdown,
    transcript: "",
    meta: [],
  };
}

/** Load one conversation document (summary + full transcript) by id. */
export async function fetchConversation(id: number | string): Promise<QueenDocument> {
  const ctx = await beeContext("prod");
  const numeric = Number(id);
  const fetched = await callBeeTextTool(ctx, "bee_get_conversation", {
    id: Number.isFinite(numeric) ? numeric : id,
    includeTranscript: true,
  });
  const detail = unwrap(fetched);
  const tz = timeZoneOf(detail);
  const rendered = conversationMarkdown({}, detail, tz);
  return {
    key: `conversation:${String(id)}`,
    kind: "conversation",
    id: String(id),
    ...rendered,
  };
}
