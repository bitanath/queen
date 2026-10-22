import { Agent, BeforeInvocationEvent, BeforeToolCallEvent, AfterToolCallEvent, ModelStreamUpdateEvent } from "@strands-agents/sdk";

import type { DocumentKind } from "../../documents";
import type { UiBridge } from "../ui-bridge";
import { automationRisk } from "../automation";
import { requestApproval } from "../../utils/approval-broker";
import { isLoggedIn } from "../../utils/bee-com-bridge";
import { toolRisk } from "../tool-definitions";
import { createAskAgent } from "./ask";
import { lastThink, stripThinking } from "../../utils/stream-status";
import { stripToolMarkup } from "../tool-definitions";
import { createOrchestratorAgent, decisionOf, fastDecision } from "./orchestrator";
import { createLaneAgent, LANE_LABELS, toolsForLane } from "./lanes";
import { executeList } from "./list-execute";
import { parseListRequest } from "./list-request";
import { listTable, recordsFromPayload, searchTable, type CollectionKind } from "./format";
import {
  clearPendingClarification,
  createSession,
  formatSession,
  rememberAction,
  rememberResult,
  setPendingClarification,
} from "./session";
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

function contextKinds(session: SessionState): string[] {
  return [session.activeDoc?.kind, session.lastResult?.kind].filter((kind): kind is string => Boolean(kind));
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

async function runLane(
  decision: RouteDecision,
  agentName: AgentName,
  session: SessionState,
  bridge: UiBridge | undefined,
  mode: "tui" | "cli",
  callbacks: TurnCallbacks,
): Promise<LaneOutcome> {
  const prompt = withContext(decision.prompt, session);
  const selectionText = decision.prompt.split("\n")[0] ?? decision.prompt;
  const selected = selectTools(agentName, selectionText, { kinds: contextKinds(session) });
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
    const request = parseListRequest(decision.prompt);
    if (request) {
      emit(callbacks.onStatus, { phase: "agent", agent: agentName, family: selected.family });
      try {
        const result = await executeList(request, session, bridge);
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

  const unsupported = detectUnsupported(decision.prompt);
  if (unsupported) {
    step.unsupported = unsupported;
    return { text: `${unsupported.reason} ${unsupported.suggestion}`, step, session };
  }

  const missing = detectMissingInput(agentName, decision.prompt, session);
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
    let text =
      stripThinking(stripToolMarkup(messageText(result.lastMessage))).trim() ||
      stripThinking(stripToolMarkup(lastToolText)).trim() ||
      "done";
    if (agentName === "bee_list" && session.lastResult) {
      const formatted = listTable(session.lastResult.kind as CollectionKind, session.lastResult.items.map((item) => item.record ?? {}));
      if (formatted.length > 0) text = formatted;
    }
    if (SEARCH_TOOLS.has(lastToolName)) {
      try {
        const payload = JSON.parse(lastToolText) as unknown;
        const records = recordsFromPayload(payload);
        const formatted = searchTable(records, lastToolName === "bee_search_facts" ? "fact" : lastToolName === "bee_search_voice_notes" ? "journal" : "conversation");
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

  constructor(options: {
    bridge?: UiBridge;
    mode: "tui" | "cli";
    session?: SessionState;
    doc?: { kind: string; id: string | number; title?: string; summary?: string };
  }) {
    this.bridge = options.bridge;
    this.mode = options.mode;
    this.session = options.session ?? createSession(options.doc);
    this.ask = createAskAgent();
    this.orchestrator = createOrchestratorAgent();
  }

  async run(request: string, callbacks: TurnCallbacks = {}): Promise<TurnResult> {
    emit(callbacks.onStatus, { phase: "ask" });
    const ack = await streamAsk(this.ask, request, this.session, callbacks);
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
          decision = decisionOf(
            await this.orchestrator.invoke(buildOrchestratorInput(request, this.session, steps)),
          );
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
        lastText = decision.prompt.trim() || ack;
        break;
      }

      const outcome = await runLane(
        decision,
        decision.agent,
        this.session,
        this.bridge,
        this.mode,
        callbacks,
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
