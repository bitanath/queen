import type { CollectionKind } from "./format";

export type ListSelection = "newest" | "oldest" | "all";
export type ListDirection = "asc" | "desc";

export type ListRequest = {
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

//TODO just some extremely fragile regex parsing to determine intent, as needs must lol
const COUNT_BEFORE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(oldest|earliest|newest|latest|first)\b/;
const SELECTOR = /\b(last|latest|newest|oldest|earliest|first|recent)\b(?:\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?/;
const LIST_CUE = /\b(?:list|show|display|give me|tell me|fetch|get|see|review|print)\b|\bwhat(?:'s| are| is) my\b|\bwhich\b.*\b(?:do i have|are mine)\b|\bdo i have any\b|\bhow many\b/;
const ORDER = /\b(ascending|asc|chronological|oldest first|earliest first|last first)\b|\b(descending|desc|reverse chronological|newest first|latest first|most recent first)\b/;
const COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/;
const SEARCHISH = /\b(?:about|with|from|mention|mentioned|say|said|talk|talked|discuss|discussed|search|find)\b/;

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
  const explicitSelector = selector !== null || before !== null;
  if (!cue && !explicitSelector) return undefined;
  if (SEARCHISH.test(lower) && !explicitSelector) return undefined;

  const rawCount = before?.[1] ?? selector?.[2] ?? (COUNT.exec(lower) ?? [])[1];
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
  return { limit: max };
}
