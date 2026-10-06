// Live status helpers for the dashboard banner.
//
// THINK is relocated verbatim from chat.tsx — the tag format here is the source
// of truth. Do not alter; chat rendering depends on this exact pattern.
export const THINK = /\x3cthink\x3e([\s\S]*?)(?:\x3c\/think\x3e|$)/g; //TODO handle thinking tokens within think tags

// Body of the most recent think block (closed or still streaming), or null when
// the reply has no thinking. We keep returning it after it closes so only
// thinking is ever surfaced — never the final output.
export function lastThink(text: string): string | null {
  THINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = THINK.exec(text)) !== null) last = m;
  return last ? (last[1] ?? "") : null;
}

// Strip thinking blocks but keep surrounding whitespace/newlines intact, so the
// result stays valid markdown for the answer modal.
export function stripThinking(text: string): string {
  THINK.lastIndex = 0;
  return text.replace(THINK, " ");
}

// One line: collapse whitespace and keep the live end (leading text is clipped).
export function tailClip(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (width <= 1) return "";
  return clean.length > width ? "…" + clean.slice(clean.length - (width - 1)) : clean;
}

// One line: the final output of a queen reply — thinking blocks removed and
// whitespace collapsed. Chat renders thinking dimmed; the alert wants only the answer.
export function finalReply(text: string): string {
  THINK.lastIndex = 0;
  return text.replace(THINK, " ").replace(/\s+/g, " ").trim();
}

// One line: collapse whitespace and keep the start (trailing text is clipped).
export function headClip(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (width <= 1) return "";
  return clean.length > width ? clean.slice(0, width - 1).trimEnd() + "…" : clean;
}

// Signals that a reply did not actually process the request: hard errors,
// login needed, refusals, unavailable/blocked tools, and similar. Deliberately
// broad — a false "unprocessed" is safer than claiming a failed turn succeeded.
const UNPROCESSED_SIGNALS = [
  /\berror\b/i,
  /\b(?:fail(?:ed|ure)?|fatal|exception)\b/i,
  /\bcan'?t\b/i,
  /\bcannot\b/i,
  /\bcould ?n'?t\b/i,
  /\bunable\b/i,
  /\bnot able\b/i,
  /\bwon'?t\b/i,
  /\bunavailable\b/i,
  /\boffline\b/i,
  /\b(?:denied|reject\w*|forbidden)\b/i,
  /\brefus\w*/i,
  /\bunauthoriz\w*/i,
  /\bunauthenticat\w*/i,
  /\bnot logged in\b/i,
  /\blogged out\b/i,
  /\b(?:need|needs|please|must|have) (?:you )?(?:to )?(?:log ?in|sign ?in)\b/i,
  /\bto (?:log ?in|sign ?in)\b/i,
  /\b(?:log ?in|sign ?in) (?:first|required|to continue)\b/i,
  /\brun \/login\b/i,
  /\b(?:invalid|missing)\b/i,
  /\bnot (?:available|supported|found)\b/i,
  /\btime[ds]? ?out\b/i,
  /\btoo many requests\b/i,
  /\brate limit\w*/i,
  /\bsorry\b/i,
  /\bapolog\w*/i,
  /\bblocked\b/i,
  /\btry again\b/i,
  /\bno access\b/i,
  /\bdon'?t have access\b/i,
];

/** True when the reply reads as a failure, refusal, or login wall. */
export function replyUnprocessed(text: string): boolean {
  return UNPROCESSED_SIGNALS.some((re) => re.test(text));
}
