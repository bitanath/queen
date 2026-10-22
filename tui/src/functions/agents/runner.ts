import { Agent, BeforeInvocationEvent, BeforeToolCallEvent, AfterToolCallEvent, ModelStreamUpdateEvent } from "@strands-agents/sdk";

import type { DocumentKind } from "../../documents";
import type { UiBridge } from "../ui-bridge";
import { automationDefs, automationRisk } from "../automation";
import { requestApproval } from "../../utils/approval-broker";
import { isLoggedIn, beeContext } from "../../utils/bee-com-bridge";
import { toolRisk } from "../tool-definitions";
import { createAskAgent } from "./ask";
import { lastThink, stripThinking } from "../../utils/stream-status";
import { stripToolMarkup } from "../tool-definitions";
import { createOrchestratorAgent, decisionOf, fastDecision } from "./orchestrator";
import { createLaneAgent, LANE_LABELS, toolsForLane } from "./lanes";
import { executeList } from "./list-execute";
import { inDateRange, parseDateRange, parseListRequest } from "./list-request";
import { listTable, recordsFromPayload, searchTable, titleOf, type CollectionKind } from "./format";
import { multiReferenceNote, referenceContent, targetLine } from "./reference-content";
import {
  clearPendingClarification,
  createSession,
  formatSession,
  referenceReadTool,
  rememberAction,
  rememberRecords,
  rememberReference,
  rememberResult,
  setPendingClarification,
} from "./session";
import type { ResolvedReference } from "./session";
import { selectTools } from "./tool-selector";
import {
  detectMissingInput,
  detectUnsupported,
  inputForMissing,
  missingFields,
} from "./validation";
import type {
  AgentName,
  AgentStatus,
  RouteDecision,
  SessionState,
  StatusListener,
  StepResult,
  ToolRunEvent,
  TurnCallbacks,
  TurnResult,
} from "./types";

const MAX_STEPS = 4;
const TOOL_CAP = 4;
export const CHAT_FALLBACK = "I couldn’t understand that request. Could you clarify what you’d like me to do?";

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type AgentRunnerDeps = {
  ack?: string;
  callTool?: ToolCaller;
  decide?: (input: string) => Promise<unknown>;
  loggedIn?: () => Promise<boolean>;
};

const WRITE_TOOLS = new Set([
  "bee_create_fact",
  "bee_update_fact",
  "bee_delete_fact",
  "bee_create_todo",
  "bee_update_todo",
  "bee_complete_todo",
  "bee_delete_todo",
  "bee_accept_todo_suggestion",
  "bee_dismiss_todo_suggestion",
]);

const DISPLAY_KINDS: Record<string, DocumentKind[]> = {
  bee_list_todos: ["todo"],
  bee_list_facts: ["fact"],
  bee_search_facts: ["fact"],
  bee_get_fact: ["fact"],
  bee_list_daily_summaries: ["daily"],
  bee_get_daily_summary: ["daily"],
  bee_get_insights: ["insight"],
  bee_get_insight: ["insight"],
  bee_list_voice_notes: ["journal"],
  bee_search_voice_notes: ["journal"],
  bee_get_voice_note: ["journal"],
  bee_get_location_clusters: ["location"],
  bee_get_recent_visits: ["location"],
  bee_get_current_location: ["location"],
  bee_list_conversations: ["conversation"],
  bee_get_conversation: ["conversation"],
  bee_get_conversation_transcript: ["conversation"],
  bee_get_related_conversations: ["conversation"],
  bee_get_today: ["conversation", "daily"],
  bee_get_recent_activity: ["conversation", "daily", "journal", "todo"],
};

type LaneOutcome = {
  text: string;
  step: StepResult;
  session: SessionState;
};

function resultText(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return resultText(parsed);
    } catch {
      return value;
    }
    return value;
  }
  if (!value || typeof value !== "object") return String(value ?? "");
  const record = value as Record<string, unknown>;
  if (record["toolResult"] !== undefined) return resultText(record["toolResult"]);
  if (Array.isArray(record["content"])) {
    return record["content"].map((item) => resultText(item)).filter((item) => item.length > 0).join("\n");
  }
  if (typeof record["text"] === "string") return resultText(record["text"]);
  if (record["json"] !== undefined) return resultText(record["json"]);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function messageText(message: { content?: readonly { type?: string; text?: unknown }[] } | undefined): string {
  return (message?.content ?? [])
    .filter((block) => block.type === "textBlock")
    .map((block) => String(block.text ?? ""))
    .join("\n")
    .trim();
}

export function riskOf(name: string): "low" | "medium" | "high" {
  const base = toolRisk(name);
  return base !== "low" ? base : automationRisk(name) ?? "low";
}

const SEARCH_TOOLS = new Set(["bee_search", "bee_search_facts", "bee_search_voice_notes"]);

function emit(status: StatusListener | undefined, next: AgentStatus): void {
  status?.(next);
}

function withContext(prompt: string, session: SessionState): string {
  if (/^(?:Original request:|Use this Bee data:|Active document:|Target item:)/m.test(prompt)) return prompt;
  if (!/\b(?:this|that|these|those|it)\b/i.test(prompt)) return prompt;
  const lines = [prompt];
  if (session.activeDoc) {
    lines.push(
      "",
      `Active document: ${session.activeDoc.kind} id=${String(session.activeDoc.id)}${session.activeDoc.title ? ` — ${session.activeDoc.title}` : ""}`,
    );
    if (session.activeDoc.summary) lines.push(session.activeDoc.summary.slice(0, 3000));
  }
  if (session.lastResult?.text) {
    lines.push("", `Last result: ${session.lastResult.text.slice(0, 3000)}`);
  }
  return lines.join("\n");
}

function contextKinds(
  prompt: string,
  session: SessionState,
  reference?: ResolvedReference,
): string[] {
  const kinds = new Set<string>();
  if (reference?.kind) kinds.add(reference.kind);
  if (/\b(?:this|that|these|those|it)\b/i.test(prompt)) {
    if (session.activeDoc?.kind) kinds.add(session.activeDoc.kind);
    if (session.lastResult?.kind) kinds.add(session.lastResult.kind);
  }
  return [...kinds];
}

export function isPlaceholderAnswer(text: string): boolean {
  return /^(?:done|ok|okay|none|null)$/i.test(text.trim());
}

export function laneText(message: string, toolText: string, mode: "tui" | "cli"): string {
  const fromMessage = stripThinking(stripToolMarkup(message)).trim();
  const fromTool = stripThinking(stripToolMarkup(toolText)).trim();
  if (mode === "cli") return fromMessage || fromTool || "done";
  if (fromMessage && !isPlaceholderAnswer(fromMessage)) return fromMessage;
  if (fromTool && !isPlaceholderAnswer(fromTool)) return fromTool;
  return CHAT_FALLBACK;
}

export function doneText(
  final: string,
  ack: string,
  mode: "tui" | "cli",
  conversational = false,
): string {
  const text = final.trim();
  if (mode === "cli") return text || ack;
  if (conversational) {
    if (text && !isPlaceholderAnswer(text)) return text;
    return ack.trim() && !isPlaceholderAnswer(ack) ? ack : CHAT_FALLBACK;
  }
  if (!text || isPlaceholderAnswer(text)) return CHAT_FALLBACK;
  return text;
}

async function defaultCallTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { callBeeTool } = await import("@/mcp/toolRegistry");
  const ctx = await beeContext("prod");
  return callBeeTool(ctx, name, args);
}

async function callToolPayload(
  name: string,
  args: Record<string, unknown>,
  callTool?: ToolCaller,
): Promise<unknown> {
  const raw = await (callTool ?? defaultCallTool)(name, args);
  const text = resultText(raw);
  if (text.length === 0) return raw;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return raw;
  }
}

function referenceArgs(kind: string, id: string | number): Record<string, unknown> {
  if (kind === "journal") return { id: String(id) };
  if (kind === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(String(id))) return { date: String(id) };
  const numeric = Number(id);
  const value = Number.isFinite(numeric) && String(id).trim().length > 0 ? numeric : id;
  if (kind === "conversation") return { id: value, includeTranscript: true };
  return { id: value };
}

function entityRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return record;
}

function transcriptText(record: Record<string, unknown>): string {
  const transcriptions = record["transcriptions"];
  if (!Array.isArray(transcriptions)) return "";
  const lines: string[] = [];
  for (const item of transcriptions) {
    if (!item || typeof item !== "object") continue;
    const utterances = (item as Record<string, unknown>)["utterances"];
    if (!Array.isArray(utterances)) continue;
    for (const utterance of utterances) {
      if (!utterance || typeof utterance !== "object") continue;
      const text = (utterance as Record<string, unknown>)["text"];
      if (typeof text === "string" && text.trim().length > 0) lines.push(text.trim());
    }
  }
  return lines.join("\n");
}

const ANSWER_KEYS: Record<string, string[]> = {
  conversation: ["short_summary", "summary", "detailed_summary", "text"],
  daily: ["short_summary", "summary", "text"],
  fact: ["text", "summary"],
  insight: ["text", "summary", "title"],
  journal: ["text", "summary", "title"],
};

export function referenceAnswerText(
  kind: string,
  payload: unknown,
): { text: string; record: Record<string, unknown> } {
  const record = entityRecord(payload);
  const values: string[] = [];
  for (const key of ANSWER_KEYS[kind] ?? ["text", "summary", "title"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const text = value.trim();
      if (!values.includes(text)) values.push(text);
    }
  }
  let text = values.join("\n\n").trim();
  if (text.length === 0 && kind === "conversation") text = transcriptText(record).trim();
  return { text: text.slice(0, 4000), record };
}

async function streamAsk(
  agent: Agent,
  prompt: string,
  session: SessionState,
  callbacks: TurnCallbacks,
): Promise<string> {
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (callbacks.isCancelled?.()) controller.abort();
  }, 120);
  let text = "";
  try {
    for await (const event of agent.stream(`${prompt}`, { cancelSignal: controller.signal })) {
      if (event.type !== "modelStreamUpdateEvent") continue;
      const inner = event.event;
      if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
        text += inner.delta.text;
        const visible = stripThinking(text).trimStart();
        if (visible.length > 0) callbacks.onAck?.(visible);
      }
    }
  } catch {
    /* fall through to the static acknowledgement */
  } finally {
    clearInterval(poll);
  }
  const visible = stripThinking(text).trim();
  if (visible.length === 0) callbacks.onAck?.("Working on it…");
  return visible.length > 0 ? visible : "Working on it…";
}

function buildOrchestratorInput(
  request: string,
  session: SessionState,
  steps: StepResult[],
): string {
  const previous = steps.map((step, index) =>
    `${index + 1}. ${step.agent} (${step.family}) → ${step.text.slice(0, 1400)}`,
  );
  return [
    `USER REQUEST\n${request}`,
    `SESSION\n${formatSession(session) || "(none)"}`,
    `COMPLETED STEPS\n${previous.length > 0 ? previous.join("\n") : "(none)"}`,
    "Choose the next step.",
  ].join("\n\n");
}

async function runReferenceRead(
  decision: RouteDecision,
  reference: ResolvedReference,
  session: SessionState,
  bridge: UiBridge | undefined,
  mode: "tui" | "cli",
  callbacks: TurnCallbacks,
  callTool?: ToolCaller,
  loggedIn: () => Promise<boolean> = isLoggedIn,
): Promise<LaneOutcome | undefined> {
  const kind = reference.kind;
  const tool = referenceReadTool(kind);
  if (!kind || !tool) return undefined;

  const args = referenceArgs(kind, reference.id);
  const step: StepResult = {
    agent: "bee_read",
    prompt: decision.prompt,
    family: kind,
    tools: [tool],
    text: "",
    direct: true,
  };

  if (!(await loggedIn())) {
    bridge?.login();
    step.text = "You are not logged in.";
    return { text: step.text, step, session };
  }

  const toolId = `direct:${tool}:${String(reference.id)}`;
  callbacks.onTool?.({ kind: "start", info: { id: toolId, name: tool, args, status: "running" } });
  try {
    const payload = await callToolPayload(tool, args, callTool);
    const answer = referenceAnswerText(kind, payload);
    let text = answer.text || reference.title || "";
    if (mode === "tui" && text.length === 0) text = CHAT_FALLBACK;
    if (mode === "tui" && isPlaceholderAnswer(text)) text = CHAT_FALLBACK;
    if (mode === "cli" && text.length === 0) text = "done";
    callbacks.onTool?.({
      kind: "end",
      info: {
        id: toolId,
        name: tool,
        args,
        status: "success",
        ...(text.length > 0 ? { result: text.slice(0, 4000) } : {}),
      },
    });
    rememberReference(
      session,
      kind,
      { ...answer.record, id: answer.record["id"] ?? reference.id },
      text,
    );
    const kinds = DISPLAY_KINDS[tool];
    if (kinds) bridge?.showDocuments({ kinds });
    step.text = text;
    return { text, step, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onTool?.({
      kind: "end",
      info: { id: toolId, name: tool, args, status: "error", error: message },
    });
    step.text = message;
    return { text: message, step, session };
  }
}

function intentOf(prompt: string): string {
  const original = /^Original request:\s*(.*)$/m.exec(prompt)?.[1]?.trim();
  if (original) return original;
  return prompt.split(/\n(?:Target item:|Use this Bee data:|Resolved reference:)/)[0]?.trim() || prompt;
}

function injectTarget(prompt: string, reference: ResolvedReference, session: SessionState): string {
  const line = targetLine(reference, session);
  const dataIndex = prompt.indexOf("\nUse this Bee data:");
  const head = dataIndex >= 0 ? prompt.slice(0, dataIndex) : prompt;
  const tail = dataIndex >= 0 ? prompt.slice(dataIndex) : "";
  const targetIndex = head.search(/^Target item:/m);
  if (targetIndex >= 0) return `${head.slice(0, targetIndex)}${line}${tail}`;
  return `${head}\n${line}${tail}`;
}

function sessionItemFor(
  reference: ResolvedReference,
  session: SessionState,
): SessionState["lastEntity"] | undefined {
  if (reference.item) return reference.item;
  const items = session.lastResult?.items ?? [];
  return items.find((item) => String(item.id) === String(reference.id)) ?? session.lastEntity;
}

function referenceItemText(item: NonNullable<SessionState["lastEntity"]>, kind?: string): string {
  return referenceContent({
    id: item.id,
    kind: item.kind ?? kind,
    title: item.title,
    item,
  }).exportText;
}

/**
 * Fill in a missing title for a URI-only reference. Todos have no get-by-id
 * tool, so fetch the open list and match the id; other kinds use their read tool.
 */
export async function hydrateReference(
  reference: ResolvedReference,
  session: SessionState,
  bridge: UiBridge | undefined,
  callbacks: TurnCallbacks,
  deps: AgentRunnerDeps,
): Promise<ResolvedReference> {
  if (reference.title || reference.id === undefined || !reference.kind) return reference;
  const kind = reference.kind;
  const tool = kind === "todo" ? "bee_list_todos" : referenceReadTool(kind);
  if (!tool) return reference;

  const loggedIn = deps.loggedIn ?? isLoggedIn;
  if (!(await loggedIn())) {
    bridge?.login();
    return reference;
  }

  const args = kind === "todo" ? { limit: 50 } : referenceArgs(kind, reference.id);
  const toolId = `hydrate:${tool}:${String(reference.id)}`;
  callbacks.onTool?.({
    kind: "start",
    info: { id: toolId, name: tool, args, status: "running" },
  });

  try {
    const payload = await callToolPayload(tool, args, deps.callTool);
    if (kind === "todo") {
      const record = recordsFromPayload(payload).find(
        (item) => String(item["id"]) === String(reference.id),
      );
      if (!record) {
        callbacks.onTool?.({
          kind: "end",
          info: { id: toolId, name: tool, args, status: "error", error: "Todo not found." },
        });
        return reference;
      }
      const title = titleOf(record, kind) || reference.title || "";
      const item = rememberReference(session, kind, record, title);
      callbacks.onTool?.({
        kind: "end",
        info: { id: toolId, name: tool, args, status: "success", ...(title ? { result: title } : {}) },
      });
      return { ...reference, ...(item ? { item } : {}), ...(title ? { title } : {}) };
    }

    const answer = referenceAnswerText(kind, payload);
    const title = (answer.text || reference.title || "").slice(0, 160);
    const item = rememberReference(
      session,
      kind,
      { ...answer.record, id: answer.record["id"] ?? reference.id },
      answer.text,
    );
    callbacks.onTool?.({
      kind: "end",
      info: {
        id: toolId,
        name: tool,
        args,
        status: "success",
        ...(answer.text ? { result: answer.text.slice(0, 4000) } : {}),
      },
    });
    return { ...reference, ...(item ? { item } : {}), ...(title ? { title } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onTool?.({
      kind: "end",
      info: { id: toolId, name: tool, args, status: "error", error: message },
    });
    return reference;
  }
}

type PlannedOsTool = {
  name: string;
  args: Record<string, unknown>;
  family: string;
};

/**
 * Simple "copy this Bee item into an OS object" actions do not need a model
 * tool-selection turn. Planning them directly keeps small models from
 * narrating instead of calling the tool.
 */
function planOsTool(
  agentName: AgentName,
  intentText: string,
  reference: ResolvedReference | undefined,
  hasInjectedData: boolean,
  session: SessionState,
): PlannedOsTool | undefined {
  if (agentName !== "os_action") return undefined;
  const lower = intentText.toLowerCase();
  const plural =
    /\b(?:these|those|them|all|both|any)\b/.test(lower) ||
    /\b(?:last|latest|newest|oldest|first|recent)\s+\d+\b/.test(lower);
  const items = session.lastResult?.items ?? [];

  if (plural) {
    if (
      /\bnotes?\b/.test(lower) &&
      items.length > 1 &&
      !/\b(?:email|mail|draft|message|imessage|text)\b/.test(lower)
    ) {
      const note = multiReferenceNote(items);
      return {
        name: "os_create_note",
        args: { title: note.title, ...(note.body ? { body: note.body } : {}) },
        family: "notes",
      };
    }
    return undefined;
  }

  if (!reference?.title) return undefined;
  const content = referenceContent(reference, session);

  if (/\breminders?\b/.test(lower)) {
    if (/\b(?:today|tomorrow|tonight|next\s+\w+|at\s+\d|by\s+\w+)\b/.test(lower)) return undefined;
    return {
      name: "os_add_reminder",
      args: {
        title: content.text || content.label,
        ...(content.due ? { due: content.due } : {}),
        ...(content.detailsPlain ? { body: content.detailsPlain } : {}),
      },
      family: "reminders",
    };
  }
  if (/\b(?:email|mail|draft)\b/.test(lower)) return undefined;
  if (/\b(?:message|imessage|text)\b/.test(lower)) return undefined;
  if (/\b(?:calendar|event|meeting|appointment)\b/.test(lower)) return undefined;
  if (/\bnotes?\b/.test(lower)) {
    if (hasInjectedData) return undefined;
    return {
      name: "os_create_note",
      args: {
        title: content.label,
        ...(content.bodyPlain ? { body: content.bodyPlain } : {}),
      },
      family: "notes",
    };
  }
  if (/\bclipboard|copy|paste\b/.test(lower)) {
    if (hasInjectedData) return undefined;
    return { name: "os_clipboard_set", args: { text: content.exportTextPlain }, family: "clipboard" };
  }
  if (/\bnotify|notification|notifications\b/.test(lower)) {
    if (hasInjectedData) return undefined;
    return {
      name: "os_notify",
      args: { title: content.label, text: content.oneLine },
      family: "notifications",
    };
  }
  if (/\bmap|maps|location\b/.test(lower) && /\b(?:show|this|that)\b/.test(lower)) {
    return { name: "os_show_location", args: { query: content.text || content.label }, family: "maps" };
  }
  return undefined;
}

async function runPlannedOsTool(
  plan: PlannedOsTool,
  session: SessionState,
  mode: "tui" | "cli",
  callbacks: TurnCallbacks,
  step: StepResult,
): Promise<LaneOutcome> {
  const def = automationDefs().find((candidate) => candidate.name === plan.name);
  if (!def) {
    const text = `${LANE_LABELS.os_action} is not available on this machine.`;
    step.text = text;
    return { text, step, session };
  }

  const required = Array.isArray(def.inputSchema.required)
    ? def.inputSchema.required.map(String)
    : [];
  const missing = required.filter((field) => {
    const value = plan.args[field];
    return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
  });
  if (missing.length > 0) {
    const question = inputForMissing(plan.name, missing);
    step.needsInput = question;
    step.text = question.question;
    return { text: question.question, step, session };
  }

  const risk = def.risk;
  if (risk !== "low") {
    emit(callbacks.onStatus, { phase: "approval", agent: "os_action", detail: plan.name });
    if (mode === "cli") {
      const text = "This action needs approval in the TUI.";
      step.approval = { tool: plan.name, args: plan.args };
      step.text = text;
      return { text, step, session };
    }
    const approved = await requestApproval({ name: plan.name, risk, args: plan.args });
    if (!approved) {
      const text = `User denied ${plan.name}.`;
      step.text = text;
      return { text, step, session };
    }
  }

  const toolId = `planned:${plan.name}:${String(step.tools[0] ?? plan.name)}`;
  callbacks.onTool?.({
    kind: "start",
    info: { id: toolId, name: plan.name, args: plan.args, status: "running" },
  });
  try {
    const text = await def.run(plan.args);
    callbacks.onTool?.({
      kind: "end",
      info: { id: toolId, name: plan.name, args: plan.args, status: "success", result: text },
    });
    step.family = plan.family;
    step.tools = [plan.name];
    step.text = text;
    return { text, step, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onTool?.({
      kind: "end",
      info: { id: toolId, name: plan.name, args: plan.args, status: "error", error: message },
    });
    step.text = message;
    return { text: message, step, session };
  }
}

async function runLane(
  decision: RouteDecision,
  agentName: AgentName,
  session: SessionState,
  bridge: UiBridge | undefined,
  mode: "tui" | "cli",
  callbacks: TurnCallbacks,
  deps: AgentRunnerDeps = {},
): Promise<LaneOutcome> {
  const intentText = decision.intent ?? intentOf(decision.prompt);
  const initialReference = decision.reference;
  const initialDirectTool = initialReference ? referenceReadTool(initialReference.kind) : undefined;
  let effective = decision;

  if (
    initialReference &&
    !initialReference.title &&
    (agentName !== "bee_read" || !initialDirectTool)
  ) {
    const hydrated = await hydrateReference(initialReference, session, bridge, callbacks, deps);
    if (hydrated !== initialReference) {
      effective = {
        ...decision,
        reference: hydrated,
        prompt: injectTarget(decision.prompt, hydrated, session),
      };
    }
  }

  const prompt = withContext(effective.prompt, session);
  const decisionReference = effective.reference;
  const reference = agentName === "bee_read" ? decisionReference : undefined;
  const directTool = referenceReadTool(reference?.kind);
  const dateRange = parseDateRange(intentText);
  const selected = directTool
    ? { family: reference?.kind ?? "item", tools: [directTool] }
    : selectTools(agentName, intentText, {
        kinds: contextKinds(intentText, session, decisionReference),
      });
  emit(callbacks.onStatus, {
    phase: "select",
    agent: agentName,
    family: selected.family,
    tools: selected.tools,
  });

  const step: StepResult = {
    agent: agentName,
    prompt,
    family: selected.family,
    tools: selected.tools,
    text: "",
  };

  if (agentName === "bee_list") {
    const request = parseListRequest(intentText);
    if (request) {
      emit(callbacks.onStatus, { phase: "agent", agent: agentName, family: selected.family });
      try {
        const result = await executeList(request, session, bridge, {
          ...(deps.callTool ? { callTool: deps.callTool } : {}),
          ...(deps.loggedIn ? { loggedIn: deps.loggedIn } : {}),
        });
        step.family = request.kind;
        step.tools = [request.tool];
        step.text = result.text;
        return { text: result.text, step, session };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.text = message;
        return { text: message, step, session };
      }
    }
  }

  const unsupported = detectUnsupported(intentText);
  if (unsupported) {
    step.unsupported = unsupported;
    return { text: `${unsupported.reason} ${unsupported.suggestion}`, step, session };
  }

  if (reference) {
    emit(callbacks.onStatus, { phase: "agent", agent: agentName, family: selected.family });
    const direct = await runReferenceRead(
      effective,
      reference,
      session,
      bridge,
      mode,
      callbacks,
      deps.callTool,
      deps.loggedIn,
    );
    if (direct) return direct;

    const item = sessionItemFor(reference, session);
    if (item) {
      const text = referenceItemText(item, reference.kind);
      step.family = reference.kind ?? "item";
      step.tools = [];
      step.text = text;
      step.direct = true;
      return { text, step, session };
    }
  }

  const planned = planOsTool(
    agentName,
    intentText,
    decisionReference,
    /\nUse this Bee data:/.test(effective.prompt),
    session,
  );
  if (planned) {
    emit(callbacks.onStatus, { phase: "agent", agent: agentName, family: planned.family });
    return runPlannedOsTool(planned, session, mode, callbacks, step);
  }

  const missing = detectMissingInput(agentName, intentText, session, decisionReference);
  if (missing) {
    step.needsInput = missing;
    return { text: missing.question, step, session };
  }

  const tools = await toolsForLane(agentName, selected.tools);
  if (tools.length === 0) {
    const unavailable = {
      reason: `${LANE_LABELS[agentName]} is not available on this machine.`,
      suggestion: "Try a Bee request instead.",
    };
    step.unsupported = unavailable;
    return { text: `${unavailable.reason} ${unavailable.suggestion}`, step, session };
  }

  const agent = createLaneAgent(agentName, tools);
  const byName = new Map(tools.map((item) => [item.name, item]));
  let used = 0;
  let lastToolText = "";
  let lastToolName = "";
  let approval: { tool: string; args: Record<string, unknown> } | undefined;
  let needsInput: { question: string; options?: string[] } | undefined;

  let rawThinking = "";
  let lastThought = "";
  agent.addHook(BeforeInvocationEvent, () => {
    used = 0;
    rawThinking = "";
    lastThought = "";
  });
  agent.addHook(ModelStreamUpdateEvent, (event) => {
    const inner = event.event as { type?: string; delta?: { type?: string; text?: string } };
    if (inner?.type !== "modelContentBlockDeltaEvent" || inner.delta?.type !== "textDelta") return;
    rawThinking += inner.delta.text ?? "";
    const thought = lastThink(rawThinking);
    if (thought !== null && thought !== lastThought) {
      lastThought = thought;
      callbacks.onThinking?.(thought);
    }
  });

  agent.addHook(BeforeToolCallEvent, async (event) => {
    if (event.cancel) return;
    const tool = event.toolUse.name;
    const args = (event.toolUse.input ?? {}) as Record<string, unknown>;
    if (tool === "bee_search") {
      if (dateRange.since !== undefined) args["since"] = dateRange.since;
      if (dateRange.until !== undefined) args["until"] = dateRange.until;
    }
    if (tool.startsWith("bee_") && !(await isLoggedIn())) {
      bridge?.login();
      event.cancel = "You are not logged in.";
      return;
    }
    used += 1;
    if (used > TOOL_CAP) {
      event.cancel = "Tool budget exhausted. Answer with what you have.";
      return;
    }
    const toolObject = byName.get(tool);
    const missingRequired = missingFields(toolObject, args);
    if (missingRequired.length > 0) {
      needsInput = inputForMissing(tool, missingRequired);
      event.cancel = `Missing input: ${needsInput.question}`;
      return;
    }
    const risk = riskOf(tool);
    if (risk !== "low") {
      emit(callbacks.onStatus, { phase: "approval", agent: agentName, detail: tool });
      if (mode === "cli") {
        approval = { tool, args };
        event.cancel = `Approval required for ${tool}.`;
        return;
      }
      const approved = await requestApproval({ name: tool, risk, args });
      if (!approved) {
        event.cancel = `User denied ${tool}.`;
        return;
      }
    }
    callbacks.onTool?.({
      kind: "start",
      info: { id: event.toolUse.toolUseId, name: tool, args, status: "running" },
    });
  });

  agent.addHook(AfterToolCallEvent, (event) => {
    const tool = event.toolUse.name;
    const text = resultText(event.result);
    if (text.length > 0) {
      lastToolText = text;
      lastToolName = tool;
    }
    callbacks.onTool?.({
      kind: "end",
      info: {
        id: event.toolUse.toolUseId,
        name: tool,
        args: (event.toolUse.input ?? {}) as Record<string, unknown>,
        status: event.error ? "error" : "success",
        ...(text.length > 0 ? { result: text.slice(0, 4000) } : {}),
        ...(event.error ? { error: event.error.message } : {}),
      },
    });
    if (event.error) return;
    if (WRITE_TOOLS.has(tool)) {
      rememberAction(session, tool, (event.toolUse.input ?? {}) as Record<string, unknown>);
      bridge?.refreshDocuments();
    } else {
      rememberResult(session, tool, event.result);
      const kinds = DISPLAY_KINDS[tool];
      if (kinds) bridge?.showDocuments({ kinds });
    }
  });

  const controller = new AbortController();
  const poll = setInterval(() => {
    if (callbacks.isCancelled?.()) controller.abort();
  }, 120);

  emit(callbacks.onStatus, { phase: "agent", agent: agentName, family: selected.family });

  try {
    const result = await agent.invoke(prompt, { cancelSignal: controller.signal });
    if (approval) {
      step.approval = approval;
      return { text: "This action needs approval in the TUI.", step, session };
    }
    if (needsInput) {
      step.needsInput = needsInput;
      return { text: needsInput.question, step, session };
    }
    let text = laneText(messageText(result.lastMessage), lastToolText, mode);
    if (agentName === "bee_list" && session.lastResult) {
      const formatted = listTable(session.lastResult.kind as CollectionKind, session.lastResult.items.map((item) => item.record ?? {}));
      if (formatted.length > 0) text = formatted;
    }
    if (SEARCH_TOOLS.has(lastToolName)) {
      try {
        const payload = JSON.parse(lastToolText) as unknown;
        const fallbackKind = lastToolName === "bee_search_facts" ? "fact" : lastToolName === "bee_search_voice_notes" ? "journal" : "conversation";
        const records = recordsFromPayload(payload).filter((record) => {
          const kind = typeof record["type"] === "string" ? record["type"] : fallbackKind;
          return inDateRange(record, dateRange, kind);
        });
        const formatted = searchTable(records, fallbackKind);
        text = formatted.length > 0 ? formatted : "_No results._";
      } catch {
        /* keep the agent's answer */
      }
    }
    step.text = text;
    return { text, step, session };
  } finally {
    clearInterval(poll);
  }
}

export class AgentRunner {
  readonly session: SessionState;
  private readonly ask: Agent;
  private readonly orchestrator: Agent;
  private readonly bridge: UiBridge | undefined;
  private readonly mode: "tui" | "cli";
  private readonly deps: AgentRunnerDeps;

  constructor(options: {
    bridge?: UiBridge;
    mode: "tui" | "cli";
    session?: SessionState;
    doc?: { kind: string; id: string | number; title?: string; summary?: string };
    deps?: AgentRunnerDeps;
  }) {
    this.bridge = options.bridge;
    this.mode = options.mode;
    this.session = options.session ?? createSession(options.doc);
    this.deps = options.deps ?? {};
    this.ask = createAskAgent();
    this.orchestrator = createOrchestratorAgent();
  }

  async run(request: string, callbacks: TurnCallbacks = {}): Promise<TurnResult> {
    emit(callbacks.onStatus, { phase: "ask" });
    const ack = this.deps.ack ?? (await streamAsk(this.ask, request, this.session, callbacks));
    if (this.deps.ack && this.deps.ack.trim().length > 0) callbacks.onAck?.(this.deps.ack);
    const steps: StepResult[] = [];
    const original = this.session.pendingClarification?.original ?? request;
    const effective = this.session.pendingClarification
      ? `${this.session.pendingClarification.original} ${request}`
      : request;
    let lastText = ack;

    const earlyUnsupported = detectUnsupported(effective);
    if (earlyUnsupported) {
      lastText = `${earlyUnsupported.reason} ${earlyUnsupported.suggestion}`;
      emit(callbacks.onStatus, { phase: "done" });
      callbacks.onText?.(lastText);
      return { text: lastText, ack, session: this.session, steps, unsupported: earlyUnsupported };
    }

    for (let index = 0; index < MAX_STEPS; index += 1) {
      emit(callbacks.onStatus, { phase: "orchestrator" });
      let decision = fastDecision(effective, this.session, steps);
      if (!decision) {
        try {
          const input = buildOrchestratorInput(request, this.session, steps);
          const raw = this.deps.decide
            ? await this.deps.decide(input)
            : await this.orchestrator.invoke(input);
          decision = decisionOf(raw as { structuredOutput?: unknown });
        } catch {
          decision = undefined;
        }
      }
      if (!decision) {
        lastText = "I couldn't work out the next step. Try rephrasing the request.";
        break;
      }

      if (decision.clarify) {
        const question = decision.prompt.trim() || "Could you clarify that?";
        setPendingClarification(this.session, question, original);
        lastText = question;
        break;
      }

      if (decision.agent === "done") {
        clearPendingClarification(this.session);
        lastText = doneText(decision.prompt, ack, this.mode, decision.conversational === true);
        break;
      }

      const outcome = await runLane(
        decision,
        decision.agent,
        this.session,
        this.bridge,
        this.mode,
        callbacks,
        this.deps,
      );
      steps.push(outcome.step);
      lastText = outcome.text;

      if (!outcome.step.needsInput && !outcome.step.unsupported && !outcome.step.approval) {
        clearPendingClarification(this.session);
      }
      if (outcome.step.needsInput) {
        setPendingClarification(this.session, outcome.step.needsInput.question, original, outcome.step.needsInput.options);
        break;
      }
      if (outcome.step.unsupported) break;
      if (outcome.step.approval) break;
      if (decision.final) break;
    }

    emit(callbacks.onStatus, { phase: "done" });
    callbacks.onText?.(lastText);
    return {
      text: lastText,
      ack,
      session: this.session,
      steps,
      ...(this.session.pendingClarification ? { clarification: this.session.pendingClarification.prompt } : {}),
      ...(steps.at(-1)?.approval ? { approval: steps.at(-1)!.approval } : {}),
      ...(steps.at(-1)?.unsupported ? { unsupported: steps.at(-1)!.unsupported } : {}),
    };
  }
}
