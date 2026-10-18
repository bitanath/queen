import { tool, type Tool } from "@strands-agents/sdk";

import { LINUX_AUTOMATIONS } from "./linux";
import { MACOS_AUTOMATIONS } from "./macos";
import type { AutomationDef } from "./types";

export type { AutomationDef } from "./types";

export function automationDefs(): AutomationDef[] {
  if (process.platform === "darwin") return MACOS_AUTOMATIONS;
  if (process.platform === "linux") return LINUX_AUTOMATIONS;
  return [];
}

export function automationTools(): Tool[] {
  return automationDefs().map((def) =>
    tool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      callback: async (raw: unknown) => def.run((raw ?? {}) as Record<string, unknown>),
    }),
  );
}

export function automationToolNames(): string[] {
  return automationDefs().map((def) => def.name);
}

export function automationRisk(name: string): "low" | "medium" | "high" | undefined {
  return automationDefs().find((def) => def.name === name)?.risk;
}
