import { beeContext, isLoggedIn } from "../../utils/bee-com-bridge";
import type { UiBridge } from "../ui-bridge";
import { listTable, recordsFromPayload, timestampOf } from "./format";
import { listArgs, type ListRequest } from "./list-request";
import { rememberRecords } from "./session";
import type { SessionState, StepResult } from "./types";

const CURSOR_TOOLS = new Set([
  "bee_list_conversations",
  "bee_list_facts",
  "bee_list_todos",
  "bee_get_insights",
  "bee_list_voice_notes",
  "bee_list_external_access",
]);

function toolText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (record["toolResult"] !== undefined) return toolText(record["toolResult"]);
  if (Array.isArray(record["content"])) {
    return record["content"].map((item) => toolText(item)).filter((item) => item.length > 0).join("\n");
  }
  if (typeof record["text"] === "string") return record["text"];
  if (record["json"] !== undefined) return toolText(record["json"]);
  return "";
}

function parsePayload(value: unknown): Record<string, unknown> | undefined {
  const text = toolText(value);
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function order(records: Record<string, unknown>[], request: ListRequest): Record<string, unknown>[] {
  const selected = [...records].sort((a, b) => {
    const at = timestampOf(a, request.kind) ?? 0;
    const bt = timestampOf(b, request.kind) ?? 0;
    return request.selection === "oldest" ? at - bt : bt - at;
  });
  const limited = request.limit !== undefined ? selected.slice(0, request.limit) : selected;
  return limited.sort((a, b) => {
    const at = timestampOf(a, request.kind) ?? 0;
    const bt = timestampOf(b, request.kind) ?? 0;
    return request.direction === "asc" ? at - bt : bt - at;
  });
}

export async function executeList(
  request: ListRequest,
  session: SessionState,
  bridge?: UiBridge,
): Promise<{ text: string; step: StepResult }> {
  if (!(await isLoggedIn())) {
    bridge?.login();
    throw new Error("You are not logged in.");
  }

  const { callBeeTool } = await import("@/mcp/toolRegistry");
  const ctx = await beeContext("prod");
  const records: Record<string, unknown>[] = [];
  const fetchAll = request.selection === "oldest" || request.limit === undefined;
  const pageCap = fetchAll ? 10 : 1;
  let cursor: string | undefined;

  for (let page = 0; page < pageCap; page += 1) {
    const args = { ...listArgs(request), ...(cursor ? { cursor } : {}) };
    const payload = parsePayload(await callBeeTool(ctx, request.tool, args));
    if (!payload) break;
    const batch = recordsFromPayload(payload);
    records.push(...batch);
    const next = payload["next_cursor"];
    if (!CURSOR_TOOLS.has(request.tool) || typeof next !== "string" || next.length === 0) break;
    cursor = next;
  }

  const selected = order(records, request);
  const text = listTable(request.kind, selected);
  rememberRecords(session, request.kind, selected, JSON.stringify(records));
  return {
    text: text.length > 0 ? text : `_No ${request.kind} found._`,
    step: {
      agent: "bee_list",
      prompt: request.tool,
      family: request.kind,
      tools: [request.tool],
      text: text.length > 0 ? text : `_No ${request.kind} found._`,
    },
  };
}
