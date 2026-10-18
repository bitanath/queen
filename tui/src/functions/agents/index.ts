export type AgentSpec = {
  name: string;
  description: string;
  systemPrompt: string;
  beeTools?: boolean;
  localTools?: string[];
};

export { orchestratorPrompt } from "./orchestrator";
export { beeAgent } from "./bee";
export { macAgent } from "./mac";
export { netAgent } from "./net";

import { beeAgent } from "./bee";
import { macAgent } from "./mac";
import { netAgent } from "./net";

/** The workers the orchestrator may call. */
export const SUB_AGENTS: AgentSpec[] = [beeAgent, macAgent, netAgent];
