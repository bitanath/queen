import { timestampOf, type CollectionKind } from "./format";

export type ListSelection = "newest" | "oldest" | "all";
export type ListDirection = "asc" | "desc";

export type DateRange = {
  since?: number;
  until?: number;
};

export type ListRequest = DateRange & {
  kind: CollectionKind;
  tool: string;
  limit?: number;
  selection: ListSelection;
  direction: ListDirection;
};

const KIND_PATTERNS: Array<{ kind: CollectionKind; test: RegExp; tool: string }> = [
  { kind: "insight", test: /\b(?:insight|insights)\b/, tool: "bee_get_insights" },
  { kind: "todo", test: /\b(?:todo|todos|task|tasks)\b/, tool: "bee_list_todos" },
  { kind: "fact", test: /\b(?:fact|facts|memory|memories)\b/, tool: "bee_list_facts" },
  { kind: "daily", test: /\b(?:daily|daily summaries|summaries)\b/, tool: "bee_list_daily_summaries" },
  { kind: "photo", test: /\b(?:photo|photos|picture|pictures|image|images)\b/, tool: "bee_get_photos" },
  { kind: "journal", test: /\b(?:journal|journals|voice note|voice notes)\b/, tool: "bee_list_voice_notes" },
  { kind: "location", test: /\b(?:location|locations|visit|visits|place|places)\b/, tool: "bee_get_recent_visits" },
  { kind: "external", test: /\b(?:external access|services.*accessed|accessed my data)\b/, tool: "bee_list_external_access" },
  { kind: "activity", test: /\b(?:activity|recent activity|what have i been up to|been up to)\b/, tool: "bee_get_recent_activity" },
  { kind: "conversation", test: /\b(?:conversation|conversations|transcript|transcripts|chat|chats)\b/, tool: "bee_list_conversations" },
  { kind: "suggestion", test: /\b(?:suggested|suggestion|suggestions)\b.*\b(?:todo|todos|task|tasks)\b|\b(?:todo|todos)\s+suggestions?\b/, tool: "bee_get_todo_suggestions" }
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};
const MONTH_PATTERN = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function localDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : undefined;
}

function parseDatePoint(value: string, now = new Date()): Date | undefined {
  const text = value.toLowerCase();
  if (/\btoday\b/.test(text)) return now;
  if (/\byesterday\b/.test(text)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date;
  }

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) return localDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`).exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1] ?? ""];
    if (month !== undefined) {
      return localDate(Number(monthFirst[3] ?? now.getFullYear()), month, Number(monthFirst[2]));
    }
  }

  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})(?:,?\\s+(\\d{4}))?\\b`).exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2] ?? ""];
    if (month !== undefined) {
      return localDate(Number(dayFirst[3] ?? now.getFullYear()), month, Number(dayFirst[1]));
    }
  }

  return undefined;
}

export function parseDateRange(prompt: string, now = new Date()): DateRange {
  const range = /(?:from|between)\s+(.+?)\s+(?:to|and|through|until)\s+(.+?)(?:$|[,.?])/i.exec(prompt);
  if (range) {
    const start = parseDatePoint(range[1] ?? "", now);
    const end = parseDatePoint(range[2] ?? "", now);
    if (start && end) {
      const since = startOfDay(start);
      const until = endOfDay(end);
      return since <= until ? { since, until } : { since: until, until: since };
    }
  }

  const result: DateRange = {};
  const after = /\b(?:after|since|from)\s+(.+)$/i.exec(prompt);
  if (after) {
    const date = parseDatePoint(after[1] ?? "", now);
    if (date) result.since = startOfDay(date);
  }
  const before = /\b(?:before|until|prior to)\s+(.+)$/i.exec(prompt);
  if (before) {
    const date = parseDatePoint(before[1] ?? "", now);
    if (date) result.until = endOfDay(date);
  }
  if (result.since !== undefined || result.until !== undefined) return result;

  const day = /\b(today|yesterday)\b/i.exec(prompt);
  if (day) {
    const date = parseDatePoint(day[1] ?? "", now);
    if (date) return { since: startOfDay(date), until: endOfDay(date) };
  }

  if (/\blast week\b/i.test(prompt)) {
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    return { since: startOfDay(since), until: endOfDay(now) };
  }
  if (/\blast month\b/i.test(prompt) || /\bthis month\b/i.test(prompt)) {
    const monthOffset = /\blast month\b/i.test(prompt) ? -1 : 0;
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
    return { since: startOfDay(start), until: endOfDay(end) };
  }
  if (/\bthis week\b/i.test(prompt)) {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { since: startOfDay(start), until: endOfDay(now) };
  }

  const monthOnly = new RegExp(`\\b(?:in|during)\\s+(${MONTH_PATTERN})\\b`, "i").exec(prompt);
  if (monthOnly) {
    const month = MONTHS[monthOnly[1]?.toLowerCase() ?? ""];
    if (month !== undefined) {
      const start = new Date(now.getFullYear(), month, 1);
      const end = new Date(now.getFullYear(), month + 1, 0);
      return { since: startOfDay(start), until: endOfDay(end) };
    }
  }

  return {};
}

export function dateOnly(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function inDateRange(
  record: Record<string, unknown>,
  range: DateRange,
  kind?: string,
): boolean {
  if (range.since === undefined && range.until === undefined) return true;
  const ts = timestampOf(record, kind);
  if (ts === undefined) return false;
  return (range.since === undefined || ts >= range.since) &&
    (range.until === undefined || ts <= range.until);
}

//TODO just some extremely fragile regex parsing to determine intent, as needs must lol
const COUNT_BEFORE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(oldest|earliest|newest|latest|first)\b/;
const SELECTOR = /\b(last|latest|newest|oldest|earliest|first|recent)\b(?:\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?/;
const LIST_CUE = /\b(?:list|show|display|give me|tell me|fetch|get|see|review|print)\b|\bwhat(?:'s| are| is) my\b|\bwhich\b.*\b(?:do i have|are mine)\b|\bdo i have any\b|\bhow many\b/;
const ORDER = /\b(ascending|asc|chronological|oldest first|earliest first|last first)\b|\b(descending|desc|reverse chronological|newest first|latest first|most recent first)\b/;
const SEARCHISH = /\b(?:about|with|mention|mentioned|say|said|talk|talked|discuss|discussed|search|find)\b/;

function kindOf(prompt: string): { kind: CollectionKind; tool: string } | undefined {
  const lower = prompt.toLowerCase();
  return KIND_PATTERNS.find((entry) => entry.test.test(lower));
}

export function parseListRequest(prompt: string): ListRequest | undefined {
  const lower = prompt.toLowerCase();
  const kind = kindOf(lower);
  if (!kind) return undefined;

  const selector = SELECTOR.exec(lower);
  const before = COUNT_BEFORE.exec(lower);
  const order = ORDER.exec(lower);
  const cue = LIST_CUE.test(lower);
  const dates = parseDateRange(prompt);
  const dated = dates.since !== undefined || dates.until !== undefined;
  const explicitSelector = selector !== null || before !== null;
  if (!cue && !explicitSelector) return undefined;
  if ((SEARCHISH.test(lower) || (!dated && /\bfrom\b/.test(lower))) && !explicitSelector) {
    return undefined;
  }

  const rawCount = before?.[1] ?? selector?.[2];
  const count = rawCount
    ? NUMBER_WORDS[rawCount] ?? (/^\d+$/.test(rawCount) ? Number(rawCount) : undefined)
    : undefined;
  const lastFirst = /\blast first\b/.test(lower);
  const selectorWord = lastFirst ? undefined : before?.[2] ?? selector?.[1];
  const selection: ListSelection =
    selectorWord === "oldest" || selectorWord === "earliest" || selectorWord === "first"
      ? "oldest"
      : selectorWord
        ? "newest"
        : "all";

  const direction: ListDirection =
    order?.[1] ? "asc" :
    order?.[2] ? "desc" :
    selection === "oldest" ? "asc" :
    "desc";

  const limit = count ?? (selectorWord && !lastFirst && /^(?:last|latest|newest|oldest|earliest|first|recent)$/.test(selectorWord) ? 1 : undefined);
  return {
    kind: kind.kind,
    tool: kind.tool,
    ...(limit !== undefined ? { limit } : {}),
    selection,
    direction,
    ...(dates.since !== undefined ? { since: dates.since } : {}),
    ...(dates.until !== undefined ? { until: dates.until } : {}),
  };
}

export const LIST_TOOL_MAX: Record<string, number> = {
  bee_list_conversations: 10,
  bee_list_todos: 20,
  bee_get_todo_suggestions: 10,
  bee_list_facts: 20,
  bee_list_daily_summaries: 10,
  bee_get_insights: 10,
  bee_list_voice_notes: 10,
  bee_get_photos: 10,
  bee_get_recent_visits: 10,
  bee_get_recent_activity: 10,
  bee_list_external_access: 20,
};

export function listArgs(request: ListRequest): Record<string, unknown> {
  const max = LIST_TOOL_MAX[request.tool] ?? 20;
  const args: Record<string, unknown> = { limit: max };
  if (request.since !== undefined || request.until !== undefined) {
    if (request.tool === "bee_list_daily_summaries") {
      if (request.since !== undefined) args["startDate"] = dateOnly(request.since);
      if (request.until !== undefined) args["endDate"] = dateOnly(request.until);
    }
    if (request.tool === "bee_get_recent_visits") {
      if (request.since !== undefined) args["from"] = dateOnly(request.since);
      if (request.until !== undefined) args["to"] = dateOnly(request.until);
    }
  }
  return args;
}
