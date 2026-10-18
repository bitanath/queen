import type { JSONSchema } from "@strands-agents/sdk";

import type { ToolRisk } from "../tool-definitions";

export type AutomationDef = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  risk: ToolRisk;
  run: (input: Record<string, unknown>) => Promise<string>;
};
