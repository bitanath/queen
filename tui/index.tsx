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
    render();
  }
}
