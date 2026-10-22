import { Agent, AfterToolCallEvent, BeforeInvocationEvent, BeforeToolCallEvent, ModelStreamUpdateEvent, SlidingWindowConversationManager, tool, type JSONSchema, type Tool } from "@strands-agents/sdk";

import { beeMeTool, toolRisk } from "./tool-definitions";
import { orchestratorPrompt, SUB_AGENTS, type AgentSpec } from "./agents";
import { TokenBudgetConversationManager } from "./conversation-manager";
import { planRoute, type RoutePlan } from "./agents/orchestrator";
import { beeToolNames, beeToolsFor } from "../libraries/bee-mcp";
import { automationRisk, automationTools } from "./automation";
import { CHAT_SYSTEM_HIGH, modelParams } from "./model-params";
import { requestApproval } from "../utils/approval-broker";
import { isLoggedIn } from "../utils/bee-com-bridge";
import type { DocumentKind } from "../documents";
import { ElthurModel } from "./strands-model";
import type { UiBridge } from "./ui-bridge";

export type AgentActivity =
  | { kind: "delta"; agent: string; text: string }
  | { kind: "tool"; agent: string; name: string };

export type ActivityObserver = (event: AgentActivity) => void;

function textDeltaOf(event: unknown): string | null {
  const e = event as { type?: string; delta?: { type?: string; text?: string } };
  if (e?.type === "modelContentBlockDeltaEvent" && e.delta?.type === "textDelta") {
    return e.delta.text ?? "";
  }
  return null;
}

function localToolMap(): Map<string, Tool> {
  const map = new Map<string, Tool>();
  map.set("bee_me", beeMeTool);
  for (const automation of automationTools()) map.set(automation.name, automation);
  return map;
}

function resolveTools(spec: AgentSpec, local: Map<string, Tool>): Tool[] {
  const tools: Tool[] = [];
  if (spec.beeTools) tools.push(...beeToolsFor(beeToolNames()));
  for (const name of spec.localTools ?? []) {
    const tool = local.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

export function toolsForWorker(name: string): Tool[] {
  const spec = SUB_AGENTS.find((item) => item.name === name);
  return spec ? resolveTools(spec, localToolMap()) : [];
}

function makeWorkerManager(): SlidingWindowConversationManager {
  return new SlidingWindowConversationManager({ windowSize: 20, shouldTruncateResults: true });
}

function makeOrchestratorManager(): TokenBudgetConversationManager {
  return new TokenBudgetConversationManager({
    budget: Math.floor(modelParams().contextWindow * 0.8),
    pinFirst: 1,
  });
}

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

export function riskOf(name: string): ReturnType<typeof toolRisk> {
  const base = toolRisk(name);
  return base !== "low" ? base : automationRisk(name) ?? "low"; //FIXME: we need to show the approval dialog box for edit/create requests on MacOS
}

function installToolGates(agent: Agent, bridge?: UiBridge): void {
  agent.addHook(BeforeToolCallEvent, async (event) => {
    if (event.cancel) return; //NOTE: already cancelled by a budget/loop guard — don't prompt
    const name = event.toolUse.name;
    const beeBacked = name.startsWith("bee_") || name === "bee";
    if (beeBacked && !(await isLoggedIn())) {
      bridge?.login();
      event.cancel = "You are not logged in.";
      return;
    }
    const risk = riskOf(name);
    if (risk === "low") return;
    const approved = await requestApproval({
      name,
      risk,
      args: (event.toolUse.input ?? {}) as Record<string, unknown>,
    });
    if (!approved) event.cancel = `User denied ${name}.`;
  });
}

const WORKER_NAMES = new Set(["bee", "mac", "linux"]);

const WORKER_TOOL_CAP = 4; //FIXME: small model tool caps to prevent overloading
const ORCHESTRATOR_TOOL_CAP = 3;

/**
 * FIXME: Claude suggested
 * The orchestrator may consult each worker at most once per invocation. Small
 * local models otherwise loop (call a worker five times in a row); cancelling a
 * repeat forces them to answer with what they already have.
 */
function installSinglePassGuard(agent: Agent): void {
  let called = new Set<string>();
  agent.addHook(BeforeInvocationEvent, () => {
    called = new Set();
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    const name = event.toolUse.name;
    if (!WORKER_NAMES.has(name)) return;
    if (called.has(name)) {
      event.cancel = `You already consulted the ${name} agent this turn. Answer the user now with what you have.`;
      return;
    }
    called.add(name);
  });
}

/**
 * FIXME: Claude suggested
 * Hard cap on tool calls within one invocation. Small local models spiral (a
 * worker calling the same read tool five times); after `cap` calls we cancel and
 * tell it to answer with what it has. Reset per invocation.
 */
function installToolCap(agent: Agent, cap: number): void {
  let used = 0;
  agent.addHook(BeforeInvocationEvent, () => {
    used = 0;
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    used += 1;
    if (used > cap) {
      event.cancel = "Tool budget exhausted for this turn. Answer the user now with what you already have.";
    }
  });
}

function installPanelRefresh(agent: Agent, bridge?: UiBridge): void {
  if (!bridge) return;
  agent.addHook(AfterToolCallEvent, (event) => {
    if (event.error) return;
    const name = event.toolUse.name;
    if (WRITE_TOOLS.has(name)) {
      bridge.refreshDocuments();
      return;
    }
    const kinds = DISPLAY_KINDS[name];
    if (kinds) bridge.showDocuments({ kinds });
  });
}

function installActivity(agent: Agent, name: string, onActivity: ActivityObserver): void {
  agent.addHook(BeforeToolCallEvent, (event) => {
    onActivity({ kind: "tool", agent: name, name: event.toolUse.name });
  });
  agent.addHook(ModelStreamUpdateEvent, (event) => {
    const text = textDeltaOf(event.event);
    if (text) onActivity({ kind: "delta", agent: name, text });
  });
}


/**
 * FIXME: Orchestrator to have a clarify tool for user intent
 * A control valve for genuine ambiguity (Bee data vs a host action). 
 * It asks the user once and returns their choice.
 */
function makeClarifyTool(bridge?: UiBridge): Tool {
  return tool({
    name: "clarify",
    description:
      "Ask the user ONE short question when a request is genuinely ambiguous between their Bee data and a host/OS action (e.g. a Bee todo vs an Apple Reminder), then act on their answer. Do not use it when the intent is already clear.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "The choices to offer (e.g. [\"Bee\", \"Mac\"]).",
        },
      },
      required: ["question"],
    } as JSONSchema,
    callback: async (raw: unknown) => {
      const input = (raw ?? {}) as { question?: unknown; options?: unknown };
      const question = String(input.question ?? "").trim();
      const options = Array.isArray(input.options) ? input.options.map(String) : ["Bee", "Mac"];
      if (!bridge) return `Ask the user: ${question || "(clarify)"} — options: ${options.join(" / ")}`;
      return bridge.clarify(question || "Where should I do this?", options);
    },
  });
}

function buildWorkers(
  bridge?: UiBridge,
  onActivity?: ActivityObserver,
): Array<{ name: string; agent: Agent }> {
  const local = localToolMap();
  const workers: Array<{ name: string; agent: Agent }> = [];
  for (const spec of SUB_AGENTS) {
    const tools = resolveTools(spec, local);
    if (tools.length === 0) continue; // e.g. the mac worker on an unsupported platform
    const worker = new Agent({
      name: spec.name,
      description: spec.description,
      model: new ElthurModel(),
      systemPrompt: spec.systemPrompt,
      tools,
      toolExecutor: "sequential",
      printer: false,
      retryStrategy: null,
      conversationManager: makeWorkerManager(),
    });
    installToolCap(worker, WORKER_TOOL_CAP);
    installToolGates(worker, bridge);
    if (spec.name === "bee") installPanelRefresh(worker, bridge);
    if (onActivity) installActivity(worker, spec.name, onActivity);
    workers.push({ name: spec.name, agent: worker });
  }
  return workers;
}

export type RoutedQueen = {
  plan: (prompt: string, docKind?: string | null) => RoutePlan;
  worker: (name: "bee" | "mac" | "linux") => Agent | undefined;
  chat: () => Agent;
};

/**
 *  Deterministic routing. `planRoute` settles the class without a model turn to save time
 *
 *   direct   -> a tool-less chat agent answers
 *   clarify  -> the caller asks the user once, then dispatches the choice
 *   worker   -> that worker agent runs the turn directly
 *
 */
export function createRoutedQueenAgent( model: ElthurModel = new ElthurModel(), bridge?: UiBridge, onActivity?: ActivityObserver): RoutedQueen {
  const workers = buildWorkers(bridge, onActivity);
  const byName = new Map(workers.map((entry) => [entry.name, entry.agent]));
  let chat: Agent | null = null;

  const chatAgent = (): Agent => {
    if (chat === null) {
      chat = new Agent({
        model,
        systemPrompt: CHAT_SYSTEM_HIGH,
        tools: [],
        toolExecutor: "sequential",
        printer: false,
        retryStrategy: null,
        conversationManager: makeOrchestratorManager(),
      });
      if (onActivity) installActivity(chat, "queen", onActivity);
    }
    return chat;
  };

  return {
    plan: (prompt, docKind) => planRoute(prompt, docKind),
    worker: (name) => byName.get(name),
    chat: chatAgent,
  };
}

//TODO: Orchestrator must orchestrate
export function createQueenAgent(model: ElthurModel = new ElthurModel(), bridge?: UiBridge, onActivity?: ActivityObserver): Agent {
  const workers = buildWorkers(bridge, onActivity).map((entry) => entry.agent);

  const orchestrator = new Agent({
    model,
    systemPrompt: orchestratorPrompt,
    tools: [...workers, makeClarifyTool(bridge)],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: makeOrchestratorManager(),
  });
  installToolCap(orchestrator, ORCHESTRATOR_TOOL_CAP);
  installSinglePassGuard(orchestrator);
  installToolGates(orchestrator, bridge);
  if (onActivity) installActivity(orchestrator, "queen", onActivity);
  return orchestrator;
}
