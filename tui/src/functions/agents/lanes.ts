import { Agent, SlidingWindowConversationManager, tool, type JSONSchema, type Tool } from "@strands-agents/sdk";

import { beeContext } from "../../utils/bee-com-bridge";
import { withSearchDefaults } from "../../documents/config";
import { beeMeTool } from "../tool-definitions";
import { automationTools } from "../automation";
import { stripSchemaDescriptions, trimToolDescription } from "../../libraries/bee-mcp";
import { ElthurModel } from "../strands-model";
import type { AgentName } from "./types";

export const LANE_LABELS: Record<AgentName, string> = {
  bee_read: "Bee read",
  bee_list: "Bee list",
  bee_write: "Bee write",
  os_action: "OS action",
};

const LANE_PROMPTS: Record<AgentName, string> = {
  bee_read: `You answer questions about the user's Bee data using only the provided read tools.
Prefer search when the request is about something the user discussed; use list/get for a named kind.
Never modify anything. If the request is conversational, answer directly.
If a tool needs an id you do not have, use a list/search tool from the set. If you still cannot resolve it, say which detail is missing.
Be concise and return the useful result, not a narration of your process.`,
  bee_list: `You list or retrieve the latest items from the user's Bee data using only the provided list tools.
For "last N" use a list tool with limit N. For "latest" use limit 1.
Do not write. Do not invent items. Return the result plainly.`,
  bee_write: `You perform Bee write actions with the provided tools.
You may only act on IDs that are present in the request or the supplied context. Never invent an ID.
If a required value is missing, stop and ask for it. Do not retry a denied action.
Return the tool result plainly.`,
  os_action: `You perform operating-system actions with the provided tools.
Use only values present in the request or supplied context. Never invent an email address, phone number, path, or title.
If a required value is missing, stop and ask for it. Do not retry a denied action.
Return the tool result plainly.`,
};

type BeeToolSpec = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
};

let beeSpecs: Map<string, BeeToolSpec> | null = null;

async function loadBeeSpecs(): Promise<Map<string, BeeToolSpec>> {
  if (beeSpecs) return beeSpecs;
  const { BEE_MCP_TOOLS } = await import("@/mcp/toolDefinitions");
  beeSpecs = new Map(
    BEE_MCP_TOOLS.map((entry) => [
      entry.name,
      {
        name: entry.name,
        description: trimToolDescription(entry.description),
        inputSchema: stripSchemaDescriptions(entry.inputSchema) as JSONSchema,
      },
    ]),
  );
  return beeSpecs;
}

async function makeBeeTool(spec: BeeToolSpec): Promise<Tool> {
  return tool({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    callback: async (raw: unknown) => {
      const [{ callBeeTool }, ctx] = await Promise.all([
        import("@/mcp/toolRegistry"),
        beeContext("prod"),
      ]);
      const input =
        spec.name === "bee_search" && raw && typeof raw === "object" && !Array.isArray(raw)
          ? withSearchDefaults(raw as Record<string, unknown>)
          : raw;
      return callBeeTool(
        ctx,
        spec.name,
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {},
      );
    },
  });
}

export async function toolsForLane(lane: AgentName, names: readonly string[]): Promise<Tool[]> {
  if (lane === "os_action") {
    const available = new Map(automationTools().map((item) => [item.name, item]));
    return names.map((name) => available.get(name)).filter((item): item is Tool => item !== undefined);
  }

  const wanted = names.filter((name) => name !== "bee_me");
  const specs = await loadBeeSpecs();
  const tools = await Promise.all(
    wanted.map((name) => {
      const spec = specs.get(name);
      return spec ? makeBeeTool(spec) : Promise.resolve(undefined);
    }),
  );
  const result = tools.filter((item): item is Tool => item !== undefined);
  if (names.includes("bee_me")) result.push(beeMeTool);
  return result;
}

export function createLaneAgent(lane: AgentName, tools: Tool[]): Agent {
  return new Agent({
    name: lane,
    description: LANE_LABELS[lane],
    model: new ElthurModel({ maxTokens: 768 }),
    systemPrompt: LANE_PROMPTS[lane],
    tools,
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: new SlidingWindowConversationManager({
      windowSize: 12,
      shouldTruncateResults: true,
    }),
  });
}
