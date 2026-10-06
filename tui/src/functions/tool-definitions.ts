import { tool, type JSONSchema, type Tool } from "@strands-agents/sdk";

// Vended tools.
import { handoffToUser } from "@strands-agents/sdk/vended-tools/handoff-to-user";
import { httpRequest } from "@strands-agents/sdk/vended-tools/http-request";
import { stop } from "@strands-agents/sdk/experimental/vended-tools/stop";
import { fileEditor } from "@strands-agents/sdk/vended-tools/file-editor";
import { makeWebFetch } from "@strands-agents/sdk/vended-tools/web-fetch";
import { notebook } from "@strands-agents/sdk/vended-tools/notebook";
import { sleep } from "@strands-agents/sdk/vended-tools/sleep";
import { bash } from "@strands-agents/sdk/vended-tools/bash";

// Bee CLI helpers.
import { beeContext, getMe } from "../utils/bee-com-bridge";
import { syncCommand } from "@/commands/sync";

export type ToolCall = { name: string; arguments: Record<string, string> };

// Markdown mode: fetch a URL and return its text directly (no analyst model call).
export const webFetch = makeWebFetch({ mode: "markdown" });

export { httpRequest, fileEditor, notebook, bash, sleep, handoffToUser, stop };

// MARK: - Bee tools
// The registry-backed Bee tools are invoked through the spawned MCP server; see
// libraries/bee-mcp.ts. Only the non-registry helpers live here.
export const beeMeTool = tool({
  name: "bee_me",
  description: "Fetch the Bee developer profile (name, timezone, id).",
  inputSchema: { type: "object", properties: {} } as JSONSchema,
  callback: () => getMe(),
});

export const beeSyncTool = tool({
  name: "bee_sync",
  description:
    "Sync Bee developer data (facts, todos, daily summaries, conversations) to markdown files in an absolute output directory.",
  inputSchema: {
    type: "object",
    properties: {
      output: { type: "string", description: "Absolute directory to write markdown into." },
      only: {
        type: "string",
        enum: ["facts", "todos", "daily", "conversations"],
        description: "Limit the sync to a single data type.",
      },
      recentDays: { type: "number", description: "Only sync the last N days (daily/conversations)." },
      full: { type: "boolean", description: "Force a full re-sync instead of incremental." },
    },
    required: ["output"],
  } as JSONSchema,
  callback: async (input) => {
    const opts = (input ?? {}) as {
      output?: unknown;
      only?: unknown;
      recentDays?: unknown;
      full?: unknown;
    };
    const output = String(opts.output ?? "").trim();
    if (!output) throw new Error("bee_sync: output directory is required");
    const args = ["--output", output];
    if (typeof opts.only === "string" && opts.only) args.push("--only", opts.only);
    if (typeof opts.recentDays === "number") args.push("--recent-days", String(opts.recentDays));
    if (opts.full === true) args.push("--full");

    // The sync command draws a TTY progress bar; silence it so it can't corrupt
    // the OpenTUI render. `isTTY` is read when the progress tracker is built.
    const stdout = process.stdout as unknown as { isTTY?: boolean };
    const wasTTY = stdout.isTTY;
    try {
      stdout.isTTY = false;
    } catch {
      /* read-only in some runtimes; progress degrades to no-op writes */
    }
    try {
      await syncCommand.run(args, await beeContext());
    } finally {
      try {
        stdout.isTTY = wasTTY;
      } catch {
        /* ignore */
      }
    }
    return `synced Bee data to ${output}`;
  },
});

// MARK: - Shared kit available to every agent
export const COMMON_TOOLS: Tool[] = [sleep, stop, handoffToUser, notebook];

// MARK: - Approval risk levels (used by the before-tool-call approval gate)
export type ToolRisk = "low" | "medium" | "high";

const HIGH_RISK = new Set([
  "bash",
  "bee_sync",
  "bee_delete_fact",
  "bee_delete_todo",
  "bee_dismiss_todo_suggestion",
  "fileEditor",
]);

const MEDIUM_RISK = new Set([
  "http_request",
  "bee_create_fact",
  "bee_update_fact",
  "bee_create_todo",
  "bee_update_todo",
  "bee_complete_todo",
  "bee_accept_todo_suggestion",
]);

export function toolRisk(name: string): ToolRisk {
  if (HIGH_RISK.has(name)) return "high";
  if (MEDIUM_RISK.has(name)) return "medium";
  return "low";
}

// MARK: - Engine plumbing

export function stripToolMarkup(text: string): string {
  const spans: [string, string][] = [
    ["<tool_call>", "</tool_call>"],
    ["<|tool_call_start|>", "<|tool_call_end|>"],
  ]; // FIXME Removes tool-call markup from streamed text to never show; an unterminated span (still streaming) is dropped until it closes.
  let out = text;
  for (const [open, close] of spans) {
    let result = "";
    let i = 0;
    while (i < out.length) {
      const s = out.indexOf(open, i);
      if (s < 0) {
        result += out.slice(i);
        break;
      }
      result += out.slice(i, s);
      const e = out.indexOf(close, s + open.length);
      if (e < 0) break;
      i = e + close.length;
    }
    out = result;
  }
  return out;
}
