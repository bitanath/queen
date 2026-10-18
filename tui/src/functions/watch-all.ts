import { requireClientToken } from "@/client/clientApi";
import { createCommandContext } from "@/context";

type SseFrame = { event: string; data: string };


function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";

  let event = "";
  let data = "";
  for (const line of lines) {
    if (line === "") {
      if (event && data !== "") frames.push({ event, data });
      event = "";
      data = "";
      continue;
    }
    if (line.startsWith(":")) continue; // keep-alive ping
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data = data === "" ? value : `${data}\n${value}`;
  }
  return { frames, rest };
}

function emit(event: string, raw: string): void {
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Error parsing SSE jsonl")
  }
  process.stdout.write(`${JSON.stringify({ event, data })}\n`);
}

async function pump(signal: AbortSignal): Promise<void> {
  const context = await createCommandContext("prod");
  const token = await requireClientToken(context);

  const headers = new Headers({ Accept: "text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await context.client.fetch("/v1/stream", { method: "GET", headers, signal });
  if (!response.ok) throw new Error(`stream failed: ${response.status}`);
  if (!response.body) throw new Error("stream has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      for (const frame of frames) emit(frame.event, frame.data);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function serveWatchAll(): Promise<void> {
  const controller = new AbortController();
  const stop = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  process.stdin.resume();

  let backoff = 1000;
  while (!controller.signal.aborted) {
    try {
      await pump(controller.signal);
      backoff = 1000; //NOTE: clean end -> reconnect promptly else wait a sec
    } catch (error) {
      if (controller.signal.aborted) break;
      process.stderr.write(`watch-all: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (controller.signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}
