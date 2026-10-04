// Agent specifications for queen. These are pure data — personality + the tools
// each specialist may use. The actual Agent objects (model, conversation
// manager, sequential executor, vended tools) are assembled in
// ../tools-execution.ts.
//
// The eight agents are mutually exclusive and collectively exhaustive over the
// Bee MCP surface; every bee_* tool is owned by exactly one specialist.

export type AgentSpec = {
  /** Tool name the orchestrator sees (`asTool`). */
  name: string;
  description: string;
  systemPrompt: string;
  /** bee-cli MCP tool names this agent may call. */
  toolNames: string[];
  /** Non-bee tool keys (bee_sync, file_editor, http_request, web_fetch, bash). */
  extraTools?: string[];
};

export { conversationAgent } from "./conversation";
export { factsAgent } from "./facts";
export { insightsAgent } from "./insights";
export { journalsAgent } from "./journals";
export { locationsAgent } from "./locations";
export { todosAgent } from "./todos";
export { filesAgent } from "./files";
export { externalAgent } from "./external";

import { conversationAgent } from "./conversation";
import { factsAgent } from "./facts";
import { insightsAgent } from "./insights";
import { journalsAgent } from "./journals";
import { locationsAgent } from "./locations";
import { todosAgent } from "./todos";
import { filesAgent } from "./files";
import { externalAgent } from "./external";

export const AGENT_SPECS: AgentSpec[] = [
  conversationAgent,
  factsAgent,
  insightsAgent,
  journalsAgent,
  locationsAgent,
  todosAgent,
  filesAgent,
  externalAgent,
];
