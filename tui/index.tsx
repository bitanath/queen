import "./src/utils/preload-env-variables";
import { tailClip } from "./src/utils/stream-status";

if (process.env.QUEEN_ROLE === "bee-mcp") {
  const [{ serveMcp }, { createCommandContext }] = await Promise.all([
    import("@/mcp/server"),
    import("@/context"),
  ]);
  await serveMcp(await createCommandContext("prod"));
} else if (process.env.QUEEN_ROLE === "watch-all") {
  const { serveWatchAll } = await import("./src/functions/watch-all");
  await serveWatchAll();
} else {
  const [
    { render },
    { runSmoke, smokeRequested },
    { jsonEnvelope, parseCliFlags, resolveCliInput, runCli },
    { renderSpec },
  ] = await Promise.all([
    import("./src/app"),
    import("./src/utils/smoke-test"),
    import("./src/functions/action/cli"),
    import("./src/functions/action/external"),
  ]);
  if (process.env.QUEEN_WARM) {
    // no-op: the exec itself is the warm-up.
  } else if (smokeRequested()) {
    void runSmoke();
  } else {
    // Anything with args, or piped stdin, is a one-shot CLI command. Only a bare
    // `queen` on a terminal opens the TUI.
    const flags = parseCliFlags(process.argv.slice(2));
    const stdinIsTTY = Boolean(process.stdin.isTTY);
    let stdinText = "";
    if (!stdinIsTTY) {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array | string>) {
          chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
        }
        stdinText = new TextDecoder().decode(
          chunks.length > 0
            ? Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
            : Buffer.alloc(0),
        );
      } catch {
        stdinText = "";
      }
    }
    const prompt = resolveCliInput({ argv: flags.argv, stdinIsTTY, stdinText });
    if (prompt === null && !flags.json) {
      render("");
    } else {
      const spinner = flags.json ? null : createSpinner();
      spinner?.start();
      let result;
      try {
        result = await runCli(prompt ?? "help", {
          json: flags.json,
          argv: flags.argv,
          ...(flags.json
            ? {}
            : {
                emit: async (spec: Parameters<typeof renderSpec>[0]) => {
                  spinner?.stop();
                  await renderSpec(spec);
                  spinner?.start();
                },
                ...(spinner
                  ? {
                      onThinking: (text: string) => spinner.setThinking(text),
                      onStatus: (status) => spinner.setStatus(status),
                    }
                  : {}),
              }),
        });
      } finally {
        spinner?.stop();
      }
      if (flags.json || result.json) {
        await writeJson(jsonEnvelope(result));
      } else {
        await renderSpec(result.spec);
      }
      process.exit(result.ok ? 0 : 1);
    }
  }
}

function createSpinner(): {
  start: () => void;
  stop: () => void;
  setThinking: (text: string) => void;
  setStatus: (status: { phase: string; agent?: string; family?: string; detail?: string }) => void;
} | null {
  if (!process.stderr.isTTY) return null;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = 0;
  let frame = 0;
  let thinking = "";
  let status = "";
  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const icon = frames[frame % frames.length] ?? frames[0];
    frame += 1;
    const rawColumns = (process.stderr as { columns?: number }).columns;
    const columns = rawColumns !== undefined && rawColumns > 0 ? rawColumns : 80;
    const label = status.length > 0 ? status : "Thinking";
    const prefix = `${icon} queen · ${seconds}s · ${label} · `;
    const budget = Math.max(0, columns - prefix.length - 1);
    const clean = thinking.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
    const thought = budget > 1 ? tailClip(clean, budget) : "";
    const suffix = thought.length > 0 ? `\x1b[90m · ${thought}\x1b[0m` : "";
    process.stderr.write(`\r\x1b[2K\x1b[2m${icon} queen · ${seconds}s · ${label}\x1b[0m${suffix}`);
  };
  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    process.stderr.write("\r\x1b[2K");
  };
  const start = () => {
    stop();
    thinking = "";
    started = Date.now();
    draw();
    timer = setInterval(draw, 100);
  };
  const setThinking = (text: string) => {
    thinking = text;
  };
  const setStatus = (next: { phase: string; agent?: string; family?: string; detail?: string }) => {
    if (next.phase === "ask") status = "Ask";
    else if (next.phase === "orchestrator") status = "Orchestrator";
    else if (next.phase === "select") status = `${next.agent ?? "agent"} · ${next.family ?? "tools"}`;
    else if (next.phase === "agent") status = next.family ? `${next.agent ?? "agent"} · ${next.family}` : next.agent ?? "agent";
    else if (next.phase === "approval") status = `approval · ${next.detail ?? "tool"}`;
    else status = "";
    thinking = "";
  };
  return { start, stop, setThinking, setStatus };
}

function writeJson(value: unknown): Promise<void> {
  return new Promise((resolve) => {
    const text = `${JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? item.toString() : item),
      2,
    )}\n`;
    process.stdout.write(text, () => resolve());
  });
}
