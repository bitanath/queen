import { topicOf } from "../../documents";
import { clockLabel, dayLabel, resolveTimeZone } from "../analytics/time";
import { beeUri, timestampOf, titleOf } from "./format";
import type { SessionItem, SessionState } from "./types";
import type { ResolvedReference } from "./session";

export type ReferenceContent = {
  kind: string;
  label: string;
  text: string;
  details: string;
  detailsPlain: string;
  body: string;
  bodyPlain: string;
  exportText: string;
  exportTextPlain: string;
  oneLine: string;
  source?: string;
  due?: string;
};

const KIND_LABEL: Record<string, string> = {
  todo: "Todo",
  suggestion: "Suggested Todo",
  fact: "Fact",
  conversation: "Conversation",
  daily: "Daily",
  insight: "Insight",
  journal: "Journal",
  location: "Location",
  photo: "Photo",
  item: "Item",
};

function epochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatWhen(ms: number): string {
  const timeZone = resolveTimeZone(undefined);
  return `${dayLabel(ms, timeZone)} · ${clockLabel(ms, timeZone)}`;
}

export function referenceLabel(kind: string, text: string): string {
  const topic = topicOf(text);
  const label = KIND_LABEL[kind] ?? kind;
  if (kind === "daily") return "📅 Daily";
  if (kind === "photo") return "📷 Photo";
  if (kind === "location") return topic.label ? `${topic.emoji} ${topic.label} Location` : "📍 Location";
  if (kind === "journal" && topic.label.length === 0) return "🎙️ Journal";
  return topic.label.length > 0 ? `${topic.emoji} ${topic.label} ${label}` : `${topic.emoji} ${label}`;
}

function findItem(reference: ResolvedReference, session?: SessionState): SessionItem | undefined {
  if (reference.item) return reference.item;
  const items = session?.lastResult?.items ?? [];
  const exact = items.find(
    (item) => String(item.id) === String(reference.id) && (!reference.kind || item.kind === reference.kind),
  );
  if (exact) return exact;
  const byId = items.find((item) => String(item.id) === String(reference.id));
  if (byId) return byId;
  if (session?.lastEntity && String(session.lastEntity.id) === String(reference.id)) return session.lastEntity;
  return undefined;
}

function statusOf(kind: string, record: Record<string, unknown>): string {
  if (kind === "todo") return record["completed"] === true ? "done" : "open";
  if (kind === "suggestion") return "pending";
  if (kind === "fact") return record["confirmed"] === true ? "confirmed" : "pending";
  return "";
}

function detailLines(
  kind: string,
  record: Record<string, unknown>,
  item: SessionItem | undefined,
  source: string | undefined,
): string[] {
  const lines: string[] = [];
  const status = statusOf(kind, record);
  if (status.length > 0) lines.push(`status: ${status}`);

  const created = timestampOf(record, kind) ?? item?.createdAt;
  if (created !== undefined) lines.push(`created: ${formatWhen(created)}`);

  const alarm = epochMs(record["alarm_at"]);
  if (alarm !== undefined) lines.push(`alarm: ${formatWhen(alarm)}`);

  if (source) lines.push(`source: ${source}`);
  return lines;
}

function markdownDetails(lines: string[]): string {
  return lines
    .map((line) => {
      const separator = line.indexOf(": ");
      if (separator < 0) return `- ${line}`;
      return `- **${line.slice(0, separator)}:** ${line.slice(separator + 2)}`;
    })
    .join("\n");
}

export function referenceContent(reference: ResolvedReference, session?: SessionState): ReferenceContent {
  const item = findItem(reference, session);
  const record = item?.record ?? {};
  const kind = item?.kind ?? reference.kind ?? "item";
  const text = (titleOf(record, kind) || reference.title || item?.title || "").trim();
  const label = referenceLabel(kind, text);
  const source = beeUri(kind, reference.id);
  const lines = detailLines(kind, record, item, source);
  const details = markdownDetails(lines);
  const detailsPlain = lines.join("\n");
  const body = [text, details].filter((part) => part.length > 0).join("\n\n---\n\n");
  const bodyPlain = [text, detailsPlain].filter((part) => part.length > 0).join("\n\n");
  const exportText = [label, body].filter((part) => part.length > 0).join("\n\n");
  const exportTextPlain = [label, bodyPlain].filter((part) => part.length > 0).join("\n\n");
  const oneLine =
    [text, statusOf(kind, record)].filter((part) => part.length > 0).join(" · ") ||
    source ||
    label;
  const alarm = epochMs(record["alarm_at"]);

  return {
    kind,
    label: label || text,
    text,
    details,
    detailsPlain,
    body,
    bodyPlain,
    exportText: exportText || label,
    exportTextPlain: exportTextPlain || label,
    oneLine,
    ...(source ? { source } : {}),
    ...(alarm !== undefined ? { due: new Date(alarm).toISOString() } : {}),
  };
}

export function referenceItemBlock(item: SessionItem, index?: number): string {
  const content = referenceContent({ id: item.id, kind: item.kind, title: item.title, item });
  const lines = [index !== undefined ? `${index + 1}. ${content.label}` : content.label];
  if (content.text && content.text !== content.label) lines.push(`   ${content.text}`);
  for (const line of content.detailsPlain.split("\n")) {
    if (line.length > 0) lines.push(`   ${line}`);
  }
  return lines.join("\n");
}

export function referenceSection(item: SessionItem): string {
  const content = referenceContent({ id: item.id, kind: item.kind, title: item.title, item });
  const parts = [content.label];
  if (content.text.length > 0) parts.push("", content.text);
  if (content.detailsPlain.length > 0) parts.push("", content.detailsPlain);
  return parts.join("\n");
}

export function multiReferenceNote(
  items: SessionItem[],
  now = Date.now(),
): { title: string; body: string } {
  const timeZone = resolveTimeZone(undefined);
  const kinds = new Set(items.map((item) => item.kind ?? "item"));
  const label = kinds.size === 1 && kinds.has("todo") ? "Todos" : "Bee items";
  const title = `📝 ${label} · ${dayLabel(now, timeZone)}`;
  const body = items
    .slice(0, 20)
    .map(referenceSection)
    .join("\n\n")
    .slice(0, 8000);
  return { title, body };
}

export function targetLine(reference: ResolvedReference, session?: SessionState): string {
  const content = referenceContent(reference, session);
  const lines = [`Target item: id=${String(reference.id)} title=${JSON.stringify(content.label)}`];
  if (content.text && content.text !== content.label) lines.push(`Target text: ${content.text}`);
  if (content.detailsPlain.length > 0) lines.push(`Target details:\n${content.detailsPlain}`);
  return lines.join("\n");
}
