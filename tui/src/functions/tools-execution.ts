import type { Agent } from "@strands-agents/sdk";

import { createAskAgent } from "./agents/ask";
import { riskOf } from "./agents/runner";

export { riskOf };
export { AgentRunner } from "./agents/runner";
export type { AgentName } from "./agents/types";

export type AgentActivity =
  | { kind: "delta"; agent: string; text: string }
  | { kind: "tool"; agent: string; name: string };

export function createQueenAgent(): Agent {
  return createAskAgent();
}
