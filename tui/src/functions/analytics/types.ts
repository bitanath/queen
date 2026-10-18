//TODO formalize raw bee documentation

export type RawConversation = {
  id: number | string;
  start_time: number;
  end_time: number | null;
  device_type?: string;
  summary?: string | null;
};

export type RawUtterance = {
  text?: string;
  speaker?: string;
  spoken_at?: number;
  start?: number;
  end?: number;
};

export type RawFact = {
  id: number | string;
  text: string;
  tags?: string[];
  created_at: number;
  confirmed?: boolean;
};

export type RawTodo = {
  id: number | string;
  text: string;
  completed?: boolean;
  created_at: number;
  alarm_at?: number | null;
};

export type RawDaily = {
  id: number | string;
  date_time: number;
  short_summary?: string | null;
  summary?: string | null;
};

export type RawData = {
  timeZone?: string;
  conversations: RawConversation[];
  transcripts: Record<string, RawUtterance[]>;
  facts: RawFact[];
  todos: RawTodo[];
  daily: RawDaily[];
};

export type Utterance = { text: string; at: number; end?: number };

export type ConversationInput = {
  id: string;
  start: number;
  end: number;
  utterances: Utterance[];
};

export type TopicKey = "travel" | "work" | "social" | "food" | "health" | "tech";
export const TOPIC_KEYS: TopicKey[] = ["travel", "work", "social", "food", "health", "tech"];

export type ConversationMetrics = {
  id: string;
  dateKey: string;
  start: number;
  end: number;
  mins: number;
  utts: number;
  words: number;
  wpm: number;
  upm: number;
  qPct: number;
  fillPct: number;
  afinn: number;
  iPct: number;
  nonEnPct: number;
  top: string[];
  topTopic: TopicKey | null;
  topicMinutes: Record<TopicKey, number>;
  hourHist: Record<number, number>;
};

export type WindowRow = {
  convId: string;
  at: number;
  dateKey: string;
  text: string;
  dims: number[];
  qPct: number;
  iPct: number;
  wePct: number;
  nonEnPct: number;
};

export type DayPoint = {
  index: number;
  dateKey: string;
  label: string;
  real: boolean;
  mins: number;
  utts: number;
  topics: Record<TopicKey, number>;
  factors: number[];
  mood: number;
  positivity: number | null;
  hourCounts: number[];
};
