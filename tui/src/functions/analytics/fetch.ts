import { beeContext } from "../../utils/bee-com-bridge";
import { callBeeTextTool } from "@/commands/mcpToolOutput";
import type { RawConversation, RawDaily, RawData, RawFact, RawTodo, RawUtterance } from "./types";

const SLEEP_MS = 100;
let detectedTimeZone: string | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const ctx = await beeContext("prod");
  const data = await callBeeTextTool(ctx, tool, args);
  const tz = data && typeof data === "object" ? (data as Record<string, unknown>)["timezone"] : undefined;
  if (typeof tz === "string" && tz.length > 0) detectedTimeZone = tz;
  await sleep(SLEEP_MS);
  return data;
}

function asRecords(value: unknown, key: string): { items: Record<string, unknown>[]; next: string | null } {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const list = Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
  const items = list.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  const next = typeof root["next_cursor"] === "string" && root["next_cursor"].length > 0 ? root["next_cursor"] : null;
  return { items, next };
}

async function listAll(tool: string, key: string, base: Record<string, unknown>, limit: number, max: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20 && out.length < max; page += 1) {
    const args = cursor ? { ...base, limit, cursor } : { ...base, limit };
    const { items, next } = asRecords(await call(tool, args), key);
    out.push(...items);
    if (!next || out.length >= max) break;
    cursor = next;
  }
  return out.slice(0, max);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function fetchRawAnalyticsData(): Promise<RawData> {
  detectedTimeZone = undefined;
  // Conversations (MCP limit clamps to 20, so paginate).
  const convRecords = await listAll("bee_list_conversations", "conversations", {}, 20, 10);
  const conversations: RawConversation[] = convRecords.map((c) => ({
    id: num(c["id"]),
    start_time: num(c["start_time"]),
    end_time: typeof c["end_time"] === "number" ? c["end_time"] : null,
    ...(typeof c["device_type"] === "string" ? { device_type: c["device_type"] } : {}),
    ...(typeof c["summary"] === "string" ? { summary: c["summary"] } : {}),
  }));

  // Transcripts, one call per conversation.
  const transcripts: Record<string, RawUtterance[]> = {};
  for (const conv of conversations) {
    const data = await call("bee_get_conversation_transcript", { id: Number(conv.id) });
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const list = Array.isArray(root["transcript"]) ? (root["transcript"] as unknown[]) : [];
    transcripts[String(conv.id)] = list
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
      .map((u) => ({
        ...(typeof u["text"] === "string" ? { text: u["text"] } : {}),
        ...(typeof u["speaker"] === "string" ? { speaker: u["speaker"] } : {}),
        ...(typeof u["spoken_at"] === "number" ? { spoken_at: u["spoken_at"] } : {}),
        ...(typeof u["start"] === "number" ? { start: u["start"] } : {}),
        ...(typeof u["end"] === "number" ? { end: u["end"] } : {}),
      }));
  }

  const dailyRecords = await listAll("bee_list_daily_summaries", "daily_summaries", {}, 30, 30);
  const daily: RawDaily[] = dailyRecords.map((d) => ({
    id: num(d["id"]),
    date_time: num(d["date_time"]),
    ...(typeof d["short_summary"] === "string" ? { short_summary: d["short_summary"] } : {}),
    ...(typeof d["summary"] === "string" ? { summary: d["summary"] } : {}),
  }));

  const factRecords = await listAll("bee_list_facts", "facts", { includeUnconfirmed: true }, 50, 100);
  const facts: RawFact[] = factRecords
    .filter((f) => typeof f["text"] === "string")
    .map((f) => ({
      id: num(f["id"]),
      text: String(f["text"]),
      created_at: num(f["created_at"]),
      ...(Array.isArray(f["tags"]) ? { tags: (f["tags"] as unknown[]).map(String) } : {}),
      ...(typeof f["confirmed"] === "boolean" ? { confirmed: f["confirmed"] } : {}),
    }));

  const todoRecords = await listAll("bee_list_todos", "todos", {}, 50, 100);
  const todos: RawTodo[] = todoRecords
    .filter((t) => typeof t["text"] === "string")
    .map((t) => ({
      id: num(t["id"]),
      text: String(t["text"]),
      created_at: num(t["created_at"]),
      ...(typeof t["completed"] === "boolean" ? { completed: t["completed"] } : {}),
      ...(typeof t["alarm_at"] === "number" ? { alarm_at: t["alarm_at"] } : {}),
    }));

  return {
    ...(detectedTimeZone ? { timeZone: detectedTimeZone } : {}),
    conversations,
    transcripts,
    facts,
    todos,
    daily,
  };
}
