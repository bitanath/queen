// Agent-facing tool for the dashboard API surface. Created here but NOT wired
// into the agent yet: attach `createDashboardTool(setSpec)` wherever the agent is
// built, and/or add DASHBOARD_TOOL to the tools JSON.
import { FunctionTool, type JSONSchema } from "@strands-agents/sdk";

import { DEFAULT_DASHBOARD_SPEC, normalizeDashboardSpec, type DashboardSpec } from "./dashboard-spec";

export const DASHBOARD_TOOL = {
  type: "function",
  function: {
    name: "render_dashboard",
    description:
      "Update the dashboard's top chart row and sessions table. Chart types: bar, sparkline, gauge, line, pie, heatmap. Provide the sessions table as columns + rows.",
    parameters: {
      type: "object",
      properties: {
        charts: {
          type: "array",
          description: "Top chart panels, in order.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["bar", "sparkline", "gauge", "line", "pie", "heatmap"] },
              title: { type: "string" },
              data: { type: "array", description: "bar/pie: [{label,value}]; sparkline/line: [numbers]; heatmap: [[numbers]]", items: {} },
              value: { type: "number", description: "gauge only" },
              label: { type: "string" },
              rowLabels: { type: "array", items: { type: "string" }, description: "heatmap row labels" },
            },
            required: ["type", "title"],
          },
        },
        sessions: {
          type: "object",
          properties: {
            title: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            aligns: { type: "array", items: { type: "string", enum: ["left", "center", "right"] } },
            rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { key: { type: "string" }, value: { type: "string" } },
                required: ["key", "value"],
              },
            },
          },
          required: ["columns", "rows"],
        },
      },
      required: ["charts", "sessions"],
    },
  },
};

export const DASHBOARD_TOOL_JSON = JSON.stringify([DASHBOARD_TOOL]);

export function createDashboardTool(onSpec: (spec: DashboardSpec) => void): FunctionTool {
  return new FunctionTool({
    name: "render_dashboard",
    description: DASHBOARD_TOOL.function.description,
    inputSchema: DASHBOARD_TOOL.function.parameters as JSONSchema,
    callback: async (input) => {
      onSpec(normalizeDashboardSpec(input, DEFAULT_DASHBOARD_SPEC));
      return "dashboard updated";
    },
  });
}
