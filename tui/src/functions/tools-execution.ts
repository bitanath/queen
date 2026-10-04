// Agent assembly for queen. Agent *specs* live in ./agents (pure data); this file
// turns each spec into a Strands Agent, wires the shared kit, the sequential
// executor (elthur runs one session at a time), and the approval gate, then
// exposes it to the orchestrator as a tool.

import {
  Agent,
  BeforeToolCallEvent,
  SlidingWindowConversationManager,
  type Tool,
} from "@strands-agents/sdk";

import { ElthurModel } from "./strands-model";
import { CHAT_SYSTEM_HIGH, modelParams } from "./model-params";
import {
  COMMON_TOOLS,
  bash,
  beeMeTool,
  beeSyncTool,
  beeToolsFor,
  fileEditor,
  httpRequest,
  toolRisk,
  weatherTool,
  webFetch,
} from "./tool-definitions";
import { AGENT_SPECS, type AgentSpec } from "./agents";
import { requestApproval } from "../utils/approval-broker";

/** Every specialist's model, keyed by agent name — used by the dashboard. */
export const agentModels = new Map<string, ElthurModel>();

/** Non-bee tool keys referenced from AgentSpec.extraTools. */
const EXTRA_TOOLS: Record<string, Tool> = {
  bee_sync: beeSyncTool,
  file_editor: fileEditor,
  http_request: httpRequest,
  web_fetch: webFetch,
  bash,
};

/** Strands-side context management, tuned per model family. */
function makeConversationManager(): SlidingWindowConversationManager {
  const p = modelParams();
  return new SlidingWindowConversationManager({
    windowSize: p.windowSize,
    shouldTruncateResults: true,
    proactiveCompression:
      p.compressionThreshold !== undefined
        ? { compressionThreshold: p.compressionThreshold }
        : false,
  });
}

/** Gate medium/high risk tool calls behind the approval modal. */
function installApprovalGate(agent: Agent): void {
  agent.addHook(BeforeToolCallEvent, async (event) => {
    const name = event.toolUse.name;
    const risk = toolRisk(name);
    if (risk === "low") return;
    const approved = await requestApproval({
      name,
      risk,
      args: (event.toolUse.input ?? {}) as Record<string, unknown>,
    });
    if (!approved) event.cancel = `User denied ${name}.`;
  });
}

/** Build a specialist agent and expose it as a tool (fresh context per call). */
export function defineBeeAgent(spec: AgentSpec, model: ElthurModel): Tool {
  agentModels.set(spec.name, model);
  const extra = (spec.extraTools ?? [])
    .map((key) => EXTRA_TOOLS[key])
    .filter((tool): tool is Tool => tool !== undefined);
  const agent = new Agent({
    name: spec.name,
    description: spec.description,
    model,
    systemPrompt: spec.systemPrompt,
    tools: [...beeToolsFor(spec.toolNames), ...extra, ...COMMON_TOOLS],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: makeConversationManager(),
  });
  installApprovalGate(agent);
  return agent.asTool({ name: spec.name, description: spec.description });
}

/**
 * The orchestrator. Holds only the small ambient tools plus the eight
 * specialists-as-tools, so its context stays lean regardless of the 35 Bee tools.
 */
export function createQueenAgent(model: ElthurModel = new ElthurModel()): Agent {
  const p = modelParams();
  const statusTool = beeToolsFor(["bee_status"])[0];
  const specialists = AGENT_SPECS.map((spec) => defineBeeAgent(spec, new ElthurModel()));

  const agent = new Agent({
    model,
    systemPrompt: p.systemPrompt ?? CHAT_SYSTEM_HIGH,
    tools: [weatherTool, ...(statusTool ? [statusTool] : []), beeMeTool, ...specialists],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: makeConversationManager(),
  });
  installApprovalGate(agent);
  return agent;
}
