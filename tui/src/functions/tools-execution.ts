// Agent assembly for queen. Agent *specs* live in ./agents (pure data); this file
// turns each spec into a Strands Agent, wires the shared kit, the sequential
// executor (elthur runs one session at a time), and the approval gate, then
// exposes it to the orchestrator as a tool.

import {
  Agent,
  BeforeToolCallEvent,
  ModelStreamUpdateEvent,
  SlidingWindowConversationManager,
  tool,
  type JSONSchema,
  type Tool,
  type ToolContext,
} from "@strands-agents/sdk";

import { ElthurModel } from "./strands-model";
import { ORCHESTRATOR_PROMPT, modelParams } from "./model-params";
import {
  COMMON_TOOLS,
  bash,
  beeMeTool,
  beeSyncTool,
  fileEditor,
  httpRequest,
  toolRisk,
  webFetch,
} from "./tool-definitions";
import { beeToolNames, beeToolsFor } from "../libraries/bee-mcp";
import { isLoggedIn } from "../utils/bee-com-bridge";
import { AGENT_SPECS, type AgentSpec } from "./agents";
import { requestApproval } from "../utils/approval-broker";

/** Every specialist's model, keyed by agent name — used by the dashboard. */
export const agentModels = new Map<string, ElthurModel>();

/**
 * Live feed from a specialist while it runs, so the dashboard can show its
 * thinking and result instead of treating the subagent as a black box.
 */
export type SpecialistEvent =
  | { kind: "delta"; agent: string; text: string }
  | { kind: "tool"; agent: string; tool: string };

export type SpecialistObserver = (event: SpecialistEvent) => void;

/** Pull the text payload out of a raw `modelContentBlockDeltaEvent`. */
function textDeltaOf(event: unknown): string | null {
  const e = event as { type?: string; delta?: { type?: string; text?: string } };
  if (e?.type === "modelContentBlockDeltaEvent" && e.delta?.type === "textDelta") {
    return e.delta.text ?? "";
  }
  return null;
}

/** Local (non-MCP) tools referenced by AgentSpec.toolNames. */
const LOCAL_TOOLS: Record<string, Tool> = {
  bee_sync: beeSyncTool,
  bee_me: beeMeTool,
  file_editor: fileEditor,
  http_request: httpRequest,
  web_fetch: webFetch,
  bash,
};

/** Resolve a spec's tool names from the Bee MCP catalog plus the local tools. */
function resolveTools(names: readonly string[]): Tool[] {
  const mcp = new Map(beeToolsFor(names).map((tool) => [tool.name, tool]));
  return names
    .map((name) => mcp.get(name) ?? LOCAL_TOOLS[name])
    .filter((tool): tool is Tool => tool !== undefined);
}

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

/** Gate tool calls: Bee tools require a login first, then medium/high risk calls
 *  go behind the approval modal. */
function installToolGates(agent: Agent): void {
  agent.addHook(BeforeToolCallEvent, async (event) => {
    const name = event.toolUse.name;
    if (name.startsWith("bee_") && !(await isLoggedIn())) {
      event.cancel = "Bee not logged in, please ask the user to login to continue";
      return;
    }
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
export function defineBeeAgent(
  spec: AgentSpec,
  model: ElthurModel,
  includeCommon = true,
  onSpecialist?: SpecialistObserver,
): Tool {
  agentModels.set(spec.name, model);
  const tools = resolveTools(spec.toolNames);
  const agent = new Agent({
    name: spec.name,
    description: spec.description,
    model,
    systemPrompt: spec.systemPrompt,
    tools: includeCommon ? [...tools, ...COMMON_TOOLS] : tools,
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: makeConversationManager(),
  });
  installToolGates(agent);
  if (onSpecialist) {
    // Forward the specialist's model deltas and tool calls to the dashboard.
    agent.addHook(ModelStreamUpdateEvent, (event) => {
      const text = textDeltaOf(event.event);
      if (text) onSpecialist({ kind: "delta", agent: spec.name, text });
    });
    agent.addHook(BeforeToolCallEvent, (event) => {
      onSpecialist({ kind: "tool", agent: spec.name, tool: event.toolUse.name });
    });
  }
  return agent.asTool({ name: spec.name, description: spec.description });
}

/** Bee MCP tools that no named specialist claims (they go to `misc`). */
export function getUnassignedBeeTools(): string[] {
  const assigned = new Set(
    AGENT_SPECS.filter((spec) => spec.name !== "misc").flatMap((spec) => spec.toolNames),
  );
  return beeToolNames().filter((name) => !assigned.has(name));
}

/** Header counts: explicitly assigned vs auto-assigned (misc) Bee tools. */
export function getToolAssignment(): { assigned: number; unassigned: number } {
  const total = beeToolNames().length;
  const unassigned = getUnassignedBeeTools().length;
  return { assigned: total - unassigned, unassigned };
}

/** Pull plain text out of a tool result's content blocks. */
function extractToolText(content: readonly { type: string; text?: string; json?: unknown }[]): string {
  return content
    .map((item) =>
      item.type === "textBlock"
        ? (item.text ?? "")
        : item.type === "jsonBlock"
          ? JSON.stringify(item.json)
          : "",
    )
    .filter((s) => s.length > 0)
    .join("\n");
}

const OFFLINE_MSG =
  "You're logged out of Bee, so I can't pull live data right now. " +
  "Run /login in this chat to connect your account, and I'll fetch it live. " +
  "Meanwhile, ask me anything and I'll help from general knowledge.";

/**
 * The orchestrator's only tool: a router that delegates to a specialist. One
 * compact tool (plus a short prompt) keeps the orchestrator's prefill tiny; the
 * specialists themselves are the same AgentAsTool instances as before.
 *
 * The specialist's answer is returned as the tool result; the orchestrator then
 * reads it and writes the final reply. Bee-backed specialists are pre-checked
 * against login so a logged-out request fails fast.
 */
function makeRouteTool(specialists: Map<string, Tool>, beeBacked: Set<string>): Tool {
  return tool({
    name: "route",
    description: "Route the request to the right Bee specialist and return its answer.",
    inputSchema: {
      type: "object",
      properties: {
        specialist: {
          type: "string",
          enum: AGENT_SPECS.map((spec) => spec.name),
          description: "Which specialist should handle the request.",
        },
        input: { type: "string", description: "The natural language request for the specialist." },
      },
      required: ["specialist", "input"],
    } as JSONSchema,
    callback: async (raw: unknown, context: ToolContext) => {
      const { specialist, input } = (raw ?? {}) as { specialist?: unknown; input?: unknown };
      const target = specialists.get(String(specialist ?? ""));
      if (!target) throw new Error(`Unknown specialist: ${String(specialist ?? "")}`);
      // Fail fast when a Bee-backed specialist is invoked while logged out.
      if (beeBacked.has(target.name) && !(await isLoggedIn())) {
        return OFFLINE_MSG;
      }
      const generator = target.stream({
        ...context,
        toolUse: { ...context.toolUse, name: target.name, input: { input: String(input ?? "") } },
      });
      let step = await generator.next();
      while (!step.done) step = await generator.next();
      return extractToolText(step.value.content);
    },
  });
}

/**
 * The orchestrator. Exposes a single routing tool so its prefill stays tiny
 * regardless of the 35 Bee tools; the specialists are untouched.
 */
export function createQueenAgent(
  model: ElthurModel = new ElthurModel(),
  onSpecialist?: SpecialistObserver,
): Agent {
  const unassigned = getUnassignedBeeTools();
  const beeBacked = new Set<string>();
  const specialists = new Map<string, Tool>();
  for (const spec of AGENT_SPECS) {
    const isMisc = spec.name === "misc";
    // `misc` gets whatever Bee tools no named specialist claimed, and no COMMON_TOOLS.
    const effective = isMisc ? { ...spec, toolNames: unassigned } : spec;
    if (effective.toolNames.some((name) => name.startsWith("bee_"))) beeBacked.add(spec.name);
    specialists.set(spec.name, defineBeeAgent(effective, new ElthurModel(), !isMisc, onSpecialist));
  }

  const agent = new Agent({
    model,
    systemPrompt: ORCHESTRATOR_PROMPT,
    tools: [makeRouteTool(specialists, beeBacked)],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: makeConversationManager(),
  });
  installToolGates(agent);
  return agent;
}
