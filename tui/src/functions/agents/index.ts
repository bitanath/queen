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
export { linuxAgent } from "./linux";

import { hostAgentName } from "../automation";
import { beeAgent } from "./bee";
import { linuxAgent } from "./linux";
import { macAgent } from "./mac";

/** All agent roles. Only the host matching this OS is routed to. */
export const AGENTS: AgentSpec[] = [beeAgent, macAgent, linuxAgent];

/** The workers the orchestrator may call on this machine. */
export const SUB_AGENTS: AgentSpec[] = [
  beeAgent,
  ...(hostAgentName() === "mac" ? [macAgent] : hostAgentName() === "linux" ? [linuxAgent] : []),
];
