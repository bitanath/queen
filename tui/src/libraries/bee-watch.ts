export type BeeWatchEvent = { event: string; data: unknown };

export type BeeWatchStatus = "connecting" | "connected" | "error" | "stopped";

export type BeeWatchState = {
  status: BeeWatchStatus;
  error: string | null;
  lastEventAt: number | null;
};

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
        try {
          const parsed = JSON.parse(line) as BeeWatchEvent;
          setState({ status: "connected", error: null, lastEventAt: Date.now() });
          for (const listener of eventListeners) listener(parsed);
        } catch {
          console.error("Malformed line from SSE")
        }
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
