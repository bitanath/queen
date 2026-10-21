import "./src/utils/preload-env-variables";

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
  const [{ render }, { runSmoke, smokeRequested }, { resolveCliInput, runCli }, { renderSpec }] =
    await Promise.all([
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
    const prompt = resolveCliInput({ argv: process.argv.slice(2), stdinIsTTY, stdinText });
    if (prompt === null) {
      render("");
    } else {
      const { spec, ok } = await runCli(prompt, { emit: renderSpec });
      await renderSpec(spec);
      process.exit(ok ? 0 : 1);
    }
  }
}
