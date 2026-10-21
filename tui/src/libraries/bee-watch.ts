import type { DocumentKind } from "../documents";
import type { DocFilter } from "../functions/ui-bridge";

export type BeeWatchEvent = { event: string; data: unknown };

export type BeeWatchStatus = "connecting" | "connected" | "error" | "stopped";

export type BeeWatchState = {
  status: BeeWatchStatus;
  error: string | null;
  lastEventAt: number | null;
};

const KINDS_FOR_EVENT: Record<string, DocumentKind[]> = {
  "new-conversation": ["conversation"],
  "update-conversation": ["conversation"],
  "update-conversation-summary": ["conversation"],
  "delete-conversation": ["conversation"],
  "new-utterance": ["conversation"],
  "update-location": ["location"],
  "todo-created": ["todo"],
  "todo-updated": ["todo"],
  "todo-deleted": ["todo"],
  "journal-created": ["journal"],
  "journal-updated": ["journal"],
  "journal-deleted": ["journal"],
  "journal-text": ["journal"],
}; //TODO documents that can be changed by Bee CLI


export function beeRefreshFor(active: DocFilter | null, event: BeeWatchEvent): DocFilter | null {
  const kinds = KINDS_FOR_EVENT[event.event];
  if (!kinds || kinds.length === 0) return null;
  if (!active) return { kinds };
  if (!active.kinds || active.kinds.length === 0) return active; //TODO SSE changes UI, or at least it should change UI
  return kinds.some((kind) => active.kinds?.includes(kind)) ? active : null;
}

export const SUPPORTED_EVENT_TYPES: readonly string[] = Object.keys(KINDS_FOR_EVENT);

let state: BeeWatchState = { status: "stopped", error: null, lastEventAt: null };
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: BeeWatchEvent) => void>();

function setState(next: Partial<BeeWatchState>): void {
  state = { ...state, ...next };
  for (const listener of stateListeners) listener();
}

export function getBeeWatchState(): BeeWatchState {
  return state;
}

export function subscribeBeeWatch(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function subscribeBeeEvents(listener: (event: BeeWatchEvent) => void): () => void {
  eventListeners.add(listener); //TODO same trick as MCP, different treat
  return () => {
    eventListeners.delete(listener);
  };
}

export function parseWatchLine(line: string): BeeWatchEvent | null {
  try {
    const parsed = JSON.parse(line) as BeeWatchEvent;
    if (!parsed || typeof parsed.event !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

type Spawned = ReturnType<typeof Bun.spawn>;

let proc: Spawned | null = null;
let starting: Promise<void> | null = null;

async function readLoop(child: Spawned): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        const parsed = parseWatchLine(line);
        if (!parsed) {
          console.error("Malformed line from SSE");
          continue;
        }
        setState({ status: "connected", error: null, lastEventAt: Date.now() });
        for (const listener of eventListeners) listener(parsed);
      }
    }
  } catch (error) {
    setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      console.error("Error SSE reader")
    }
    if (proc === child) setState({ status: "stopped" });
  }
}

export function startBeeWatch(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    setState({ status: "connecting", error: null });
    try {
      const compiled = typeof process.env.QUEEN_BEE_SHA === "string"; //HACK easy way to fixate on bun run dev
      const entry = compiled ? undefined : new URL("../../index.tsx", import.meta.url).pathname;
      const child = Bun.spawn({
        cmd: entry ? [process.execPath, entry] : [process.execPath],
        env: { ...(process.env as Record<string, string>), QUEEN_ROLE: "watch-all", BEE_FORCE_FILE_STORE: "1" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      });
      proc = child;
      void readLoop(child);
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return starting;
}

export async function stopBeeWatch(): Promise<void> {
  const child = proc;
  proc = null;
  starting = null;
  setState({ status: "stopped", error: null });
  try {
    child?.kill();
  } catch {
    console.error("Unable to exit from SSE")
  }
}
