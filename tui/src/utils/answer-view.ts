import type { TableSpec } from "./dashboard-spec";

/** One `/search` hit, pre-shaped for the result cards. */
export type SearchResult = {
  id: string;
  type: string;
  score: number;
  when: string;
  title: string;
  snippet: string;
};

/** What the answer modal should render: prose, a table, search cards, or a detail. */
export type AnswerView = {
  title: string;
  markdown?: string;
  table?: TableSpec;
  results?: SearchResult[];
  detail?: AnswerDetail;
};

/** Structured drill-down detail for one entity (meta hidden when unknown). */
export type AnswerDetail = {
  meta: { key: string; value: string }[];
  body?: string;
  transcript?: TranscriptLine[];
};

/** One transcript utterance; `at`/`end` are ms (for turn-gap heuristics). */
export type TranscriptLine = {
  speaker: string;
  text: string;
  at?: number;
  end?: number;
};
