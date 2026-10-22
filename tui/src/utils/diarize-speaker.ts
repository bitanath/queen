//FIXME: Approximate speaker labels for a transcript. Text-only diarization is guesswork (only 3 party diarization)
import { loadConfig } from "../documents/config";
import type { TranscriptLine } from "./answer-view";

const GREETING = /^(hi|hey|hello|yo|what'?s up|good (morning|afternoon|evening))\b/i;
const BACKCHANNEL = /^(okay|ok|k|hmm+|mm+|yeah|yep|yes|no|nope|right|sure|fine|uh+h?|ah+|oh+)[.!?]*$/i;
const PLACEHOLDER = /^(unknown|speaker|n\/?a|none|\(none\)|null|undefined|)$/i;

type Rec = Record<string, unknown>;
type DiarizableLine = TranscriptLine & { inferred?: boolean };

function toMs(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : undefined;
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined;
  return parsed > 1e12 ? parsed : parsed * 1000;
}

function usableSpeaker(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !PLACEHOLDER.test(trimmed);
}

function hasUsableSpeakers(lines: readonly { speaker: string }[]): boolean {
  return lines.some((line) => usableSpeaker(line.speaker));
}

function utteranceLine(utterance: Rec): TranscriptLine {
  const speaker = typeof utterance["speaker"] === "string" ? utterance["speaker"].trim() : "";
  const text = typeof utterance["text"] === "string" ? utterance["text"].trim() : "";
  const spokenAt = toMs(utterance["spoken_at"]);
  const start = toMs(utterance["start"]);
  const end = toMs(utterance["end"]);
  const at = spokenAt ?? start;
  
  const lineEnd =
    spokenAt !== undefined && start !== undefined && end !== undefined && end >= start
      ? spokenAt + (end - start)
      : end ?? at;
  return {
    speaker,
    text,
    ...(at !== undefined ? { at, ...(lineEnd !== undefined ? { end: lineEnd } : {}) } : {}),
  };
}

export function heuristicSpeakers(lines: TranscriptLine[]): string[] {
  const labels: string[] = [];
  let current: "A" | "B" = "A";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (i === 0) {
      labels.push("Speaker A");
      continue;
    }
    const prev = lines[i - 1]!;
    const text = line.text.trim();
    const prevText = prev.text.trim();
    const gap = line.at !== undefined && prev.end !== undefined ? line.at - prev.end : 0;
    const answered = /\?\s*$/.test(prevText);
    const greeted = GREETING.test(text);
    const backchannel = BACKCHANNEL.test(prevText) && text.length > 40;

    // A greeting right after a question is ambiguous — don't force A or B.
    if (greeted && answered) {
      labels.push("Speaker C");
      continue;
    }
    if (gap > 2000 || answered || greeted || backchannel) current = current === "A" ? "B" : "A";
    labels.push(`Speaker ${current}`);
  }
  return labels;
}

export function speakerLabels(
  lines: readonly DiarizableLine[],
  enabled = loadConfig().autoDiarization,
): string[] {
  if (!enabled) return lines.map((line) => line.speaker || "Speaker");
  if (lines.some((line) => line.inferred === true)) return lines.map((line) => line.speaker || "Speaker");
  if (hasUsableSpeakers(lines)) return lines.map((line) => line.speaker || "Speaker");
  return heuristicSpeakers(lines as TranscriptLine[]);
}

/** True when the labels shown for these lines came from the local heuristic. */
export function labelsAreInferred(
  lines: readonly DiarizableLine[],
  enabled = loadConfig().autoDiarization,
): boolean {
  if (!enabled) return false;
  if (lines.some((line) => line.inferred === true)) return true;
  return !hasUsableSpeakers(lines);
}

function annotateUtteranceArray(utterances: Rec[]): void {
  const entries = utterances
    .map((utterance, index) => ({ utterance, index, line: utteranceLine(utterance) }))
    .filter((entry) => entry.line.text.length > 0);
  if (entries.length === 0 || hasUsableSpeakers(entries.map((entry) => entry.line))) return;

  const sorted = [...entries].sort(
    (a, b) => (a.line.at ?? 0) - (b.line.at ?? 0) || a.index - b.index,
  );
  const labels = heuristicSpeakers(sorted.map((entry) => entry.line));
  sorted.forEach((entry, index) => {
    entry.utterance["inferred_speaker"] = labels[index] ?? "Speaker A";
  });
}

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUtteranceArray(value: unknown): value is Rec[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item["text"] === "string" &&
        ("speaker" in item || "inferred_speaker" in item || "spoken_at" in item || "start" in item || "end" in item),
    )
  );
}

function annotateNode(node: unknown): void {
  if (Array.isArray(node)) {
    if (isUtteranceArray(node)) {
      annotateUtteranceArray(node);
      return;
    }
    for (const item of node) annotateNode(item);
    return;
  }
  if (!isRecord(node)) return;
  const utterances = node["utterances"];
  if (isUtteranceArray(utterances)) annotateUtteranceArray(utterances);
  for (const value of Object.values(node)) annotateNode(value);
}

export function withInferredSpeakers<T>(payload: T, enabled = loadConfig().autoDiarization): T {
  if (!enabled) return payload;
  const clone = structuredClone(payload);
  annotateNode(clone);
  return clone;
}
