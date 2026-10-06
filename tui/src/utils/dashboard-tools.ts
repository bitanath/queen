// Agent-facing tool for the dashboard API surface. Created here but NOT wired
// into the agent yet: attach `createDashboardTool(setSpec)` wherever the agent is
// built, and/or add DASHBOARD_TOOL to the tools JSON.
// TODO: register createDashboardTool(setSpec) on the agent so chat can mutate the dashboard.
import { FunctionTool, type JSONSchema } from "@strands-agents/sdk";

import { DEFAULT_DASHBOARD_SPEC, normalizeDashboardSpec, type DashboardSpec } from "./dashboard-spec";

export const DASHBOARD_TOOL = {
  type: "function",
  function: {
    name: "render_dashboard",
    description:
      "Update the dashboard: top chart row, main table, status banner, context bars and alert banner. Chart types: bar, sparkline, gauge, line, pie, heatmap. Provide the table as columns + rows.",
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
        table: {
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
        context: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "use 'tokens' for the live context bar" },
                  label: { type: "string" },
                  value: { type: "number" },
                  total: { type: "number" },
                  status: { type: "string", enum: ["pending", "running", "done", "error"] },
                },
                required: ["label", "value", "total"],
              },
            },
          },
        },
        alert: {
          type: "object",
          properties: {
            variant: { type: "string", enum: ["success", "error", "warning", "info"] },
            title: { type: "string" },
            message: { type: "string" },
            appendix: { type: "string" },
          },
        },
      },
      required: ["charts", "table"],
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
