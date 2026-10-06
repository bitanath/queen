// Agent specifications for queen. These are pure data — personality + the tools
// each specialist may use. The actual Agent objects (model, conversation
// manager, sequential executor, vended tools) are assembled in
// ../tools-execution.ts.
//
// Tool names are resolved at runtime from the Bee MCP catalog (with a few local
// vended tools mixed in); `misc` is special — its tools are the MCP tools that no
// named specialist claims, assigned in createQueenAgent.

export type AgentSpec = {
  /** Tool name the orchestrator sees (`asTool`). */
  name: string;
  description: string;
  systemPrompt: string;
  /** Tool names this agent may call (Bee MCP names + local vended names). */
  toolNames: string[];
};

export { conversationAgent } from "./conversation";
export { factsAgent } from "./facts";
export { insightsAgent } from "./insights";
export { journalsAgent } from "./journals";
export { todosAgent } from "./todos";
export { filesAgent } from "./files";
export { externalAgent } from "./external";
import { conversationAgent } from "./conversation";
import { factsAgent } from "./facts";
import { insightsAgent } from "./insights";
import { journalsAgent } from "./journals";
import { todosAgent } from "./todos";
import { filesAgent } from "./files";
import { externalAgent } from "./external";

/**
 * Catch-all for Bee tools no named specialist owns. Strict by design: it only
 * calls a matching tool and otherwise refuses — never answers from knowledge.
 */
export const miscAgent: AgentSpec = {
  name: "misc",
  description:
    "Handles Bee tools that no named specialist owns. Strict: only calls a matching tool, otherwise refuses.",
  systemPrompt: `You are the misc specialist. You hold Bee tools that no other specialist owns.
- If exactly one of your tools matches the request, call it and return its result.
- Otherwise refuse outright: say you cannot help with that. Never answer from general knowledge and never guess.`,
  toolNames: [],
};

export const AGENT_SPECS: AgentSpec[] = [
  conversationAgent,
  factsAgent,
  insightsAgent,
  journalsAgent,
  todosAgent,
  filesAgent,
  externalAgent,
  miscAgent,
];
