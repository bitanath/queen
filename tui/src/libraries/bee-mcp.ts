import {
  McpClient,
  TextBlock,
  Tool,
  ToolResultBlock,
  type JSONSchema,
  type JSONValue,
  type ToolContext,
  type ToolSpec,
  type ToolStreamGenerator,
} from "@strands-agents/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { withSearchDefaults } from "../documents/config";

const TOOL_TIMEOUT_MS = 30_000;
const DESC_CAP = 100;

type McpToolLike = Awaited<ReturnType<McpClient["listTools"]>>[number];

export type BeeMcpStatus = "connecting" | "connected" | "error" | "stopped";

export type BeeMcpState = { status: BeeMcpStatus; toolCount: number; error: string | null };

let state: BeeMcpState = { status: "stopped", toolCount: 0, error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<BeeMcpState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function getBeeMcpState(): BeeMcpState {
  return state;
}

export function subscribeBeeMcp(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let client: McpClient | null = null;
let toolsByName = new Map<string, Tool>();
let rawTools = new Map<string, McpToolLike>();
let starting: Promise<void> | null = null;

export function beeToolsFor(names: readonly string[]): Tool[] {
  const allow = new Set(names);
  return [...toolsByName.values()].filter((tool) => allow.has(tool.name));
}


export function beeToolNames(): string[] {
  return [...toolsByName.keys()];
}

export async function invokeBeeTool(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const tool = rawTools.get(name);
  if (!client || !tool) throw new Error(`bee tool not available: ${name}`);
  return client.callTool(tool, input as unknown as JSONValue);
}

export function startBeeMcp(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    setState({ status: "connecting", error: null });
    try {
      const compiled = typeof process.env.QUEEN_BEE_SHA === "string";
      const entry = compiled ? undefined : new URL("../../index.tsx", import.meta.url).pathname;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: entry ? [entry] : [],
        env: { ...(process.env as Record<string, string>), QUEEN_ROLE: "bee-mcp", BEE_FORCE_FILE_STORE: "1" },
        stderr: "ignore",
      });
      client = new McpClient({ transport });
      await client.connect();
      const listed = await client.listTools();
      rawTools = new Map(listed.map((tool) => [tool.name, tool]));
      toolsByName = new Map(listed.map((tool) => [tool.name, new TimedMcpTool(tool, TOOL_TIMEOUT_MS)]));
      setState({ status: "connected", toolCount: toolsByName.size, error: null });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return starting;
}

export async function ensureBeeMcp(): Promise<void> {
  await startBeeMcp();
  const current = getBeeMcpState();
  if (current.status !== "connected") {
    throw new Error(current.error ?? `Bee MCP ${current.status}`);
  }
}

export async function stopBeeMcp(): Promise<void> {
  const current = client;
  client = null;
  starting = null;
  toolsByName = new Map();
  rawTools = new Map();
  setState({ status: "stopped", toolCount: 0 });
  try {
    await current?.disconnect();
  } catch {
    /* ignore */
  }
}


//FIXME: Aggressive: keep only the first sentence of the tool description.
function trimDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=\.)\s/, 1)[0] ?? clean;
  const base = first.length > 0 ? first : clean;
  return base.length > DESC_CAP ? `${base.slice(0, DESC_CAP - 3).trimEnd()}...` : base;
}

//FIXME: Aggressive: drop every nested `description` key, keep schema structure.
function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "description") continue;
      out[key] = stripDescriptions(val);
    }
    return out;
  }
  return value;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any;
  if (anyFn) return anyFn(signals);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

/**
 * XXX claude recommended changes need to test these
 * Wraps an McpTool with a trimmed spec (token savings) and a hard 30s timeout
 * that reports back to the model as "tool called timeout". Streaming is
 * delegated so content mapping (text/image/resource) stays the SDK's.
 */
class TimedMcpTool extends Tool {
  name: string;
  description: string;
  toolSpec: ToolSpec;
  private readonly inner: McpToolLike;
  private readonly ms: number;

  constructor(inner: McpToolLike, ms: number) {
    super();
    this.inner = inner;
    this.ms = ms;
    this.name = inner.name;
    this.description = trimDescription(inner.description);
    this.toolSpec = {
      ...inner.toolSpec,
      description: this.description,
      inputSchema: stripDescriptions(inner.toolSpec.inputSchema) as JSONSchema,
    };
  }

  async *stream(context: ToolContext): ToolStreamGenerator {
    const timeout = AbortSignal.timeout(this.ms);
    let timedOut = false;
    timeout.addEventListener("abort", () => {
      timedOut = true;
    }, { once: true });
    const input =
      this.name === "bee_search" ? withSearchDefaults(context.toolUse.input) : context.toolUse.input;
    const toolContext =
      input === context.toolUse.input
        ? context
        : { ...context, toolUse: { ...context.toolUse, input: input as JSONValue } };
    const generator = this.inner.stream({
      ...toolContext,
      cancelSignal: anySignal([context.cancelSignal, timeout]),
    });
    let step = await generator.next();
    while (!step.done) {
      yield step.value;
      step = await generator.next();
    }
    if (timedOut) {
      return new ToolResultBlock({
        toolUseId: context.toolUse.toolUseId,
        status: "error",
        content: [new TextBlock("tool called timeout")],
      });
    }
    return step.value;
  }
}
