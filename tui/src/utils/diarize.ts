// Approximate speaker labels for a transcript. Text-only diarization is
// guesswork, and the local 4B spends its entire token budget on reasoning
// (the engine always opens the model's think block and ignores /no_think), so
// a model pass can't complete for real transcripts. We use a deterministic
// cascade instead: default Speaker A, Speaker B only on strong turn cues, and
// Speaker C when a boundary is ambiguous. Never emits more than A/B/C.
import type { TranscriptLine } from "./answer-view";

const GREETING = /^(hi|hey|hello|yo|what'?s up|good (morning|afternoon|evening))\b/i;
const BACKCHANNEL = /^(okay|ok|k|hmm+|mm+|yeah|yep|yes|no|nope|right|sure|fine|uh+h?|ah+|oh+)[.!?]*$/i;

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
