import { render } from "./app";
import { chatGenerate } from "./queen-ffi";

// QUEEN_SMOKE=1 <prompt>: one blocking generation, print it, exit. Verifies the
// embedded dylib + the model appended to this executable without a terminal.
if (process.env.QUEEN_SMOKE) {
  const prompt = process.env.QUEEN_SMOKE === "1" ? "Say hello in one short sentence." : process.env.QUEEN_SMOKE;
  try {
    console.log("QUEEN_SMOKE:", JSON.stringify(chatGenerate(prompt)));
  } catch (e) {
    console.error("QUEEN_SMOKE_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
} else {
  render();
}
