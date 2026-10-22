import { LINUX_AUTOMATIONS } from "../automation/linux";
import type { AgentSpec } from "./index";

export const linuxAgent: AgentSpec = {
  name: "linux",
  description:
    "Linux host actions: open URLs, clipboard, desktop notifications, reveal files, and system status.",
  systemPrompt: `You are the Linux host automation agent. You perform OS actions.
- Call exactly one tool per request, using the arguments given.
- Writing tools may be shown to the user for approval. If a tool is denied, stop and report it; never retry.
- Return the tool result verbatim. Do not add commentary.`,
  localTools: LINUX_AUTOMATIONS.map((def) => def.name),
};
