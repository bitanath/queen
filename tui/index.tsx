import "./src/utils/preload-env-variables";

if (process.env.QUEEN_ROLE === "bee-mcp") {
  const [{ serveMcp }, { createCommandContext }] = await Promise.all([
    import("@/mcp/server"),
    import("@/context"),
  ]);
  await serveMcp(await createCommandContext("prod"));
} else {
  const [{ render }, { runSmoke, smokeRequested }] = await Promise.all([
    import("./src/app"),
    import("./src/utils/smoke-test"),
  ]);
  if (process.env.QUEEN_WARM) {
    // no-op: the exec itself is the warm-up.
  } else if (smokeRequested()) {
    void runSmoke();
  } else {
    // `queen fetch all TODOs before yesterday` and
    // `queen "fetch all TODOs before yesterday"` both arrive here as one line.
    const prompt = process.argv.slice(2).join(" ").trim();
    const { runExternalCommand } = await import("./src/functions/action/external");
    if (await runExternalCommand(prompt)) {
      process.exit(0);
    }
    render(prompt);
  }
}
