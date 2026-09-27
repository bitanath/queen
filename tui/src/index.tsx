import "./preload";
import { render } from "./app";
import { chatGenerate, streamChatWithTools } from "./queen-ffi";
import { createQueenAgent } from "./strands-model";
import { TOOLS_JSON, runTool, stripToolMarkup } from "./tools";

// QUEEN_AGENT_SMOKE="<prompt>": one full Strands agent turn (memory + tools)
// without a terminal. QUEEN_AGENT_SMOKE=1 uses a weather prompt to exercise the
// tool loop end to end.
if (process.env.QUEEN_AGENT_SMOKE) {
  const raw = process.env.QUEEN_AGENT_SMOKE;
  const prompt = raw === "1" ? "What is the weather in Tokyo?" : raw;
  void (async () => {
    try {
      const agent = createQueenAgent();
      const result = await agent.invoke(prompt);
      console.log("QUEEN_AGENT_SMOKE:", JSON.stringify(result.toString()));
      console.log("QUEEN_AGENT_STOP:", result.stopReason);
      console.log("QUEEN_AGENT_MESSAGES:", agent.messages.length);
    } catch (e) {
      console.error("QUEEN_AGENT_SMOKE_ERROR:", e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  })();
} else if (process.env.QUEEN_SMOKE) {
  const prompt = process.env.QUEEN_SMOKE === "1" ? "Say hello in one short sentence." : process.env.QUEEN_SMOKE;
  try {
    console.log("QUEEN_SMOKE:", JSON.stringify(chatGenerate(prompt)));
  } catch (e) {
    console.error("QUEEN_SMOKE_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
} else if (process.env.QUEEN_TOOL_SMOKE) {
  // QUEEN_TOOL_SMOKE="<prompt>": one tool-enabled generation, then run the
  // returned call. Same idea as QUEEN_SMOKE, for the tool path.
  const prompt = process.env.QUEEN_TOOL_SMOKE;
  void (async () => {
    try {
      const res = await streamChatWithTools(prompt, TOOLS_JSON, () => {}, () => false);
      console.log("QUEEN_TOOL_SMOKE_CALLS:", JSON.stringify(res.toolCalls));
      console.log("QUEEN_TOOL_SMOKE_TEXT:", JSON.stringify(stripToolMarkup(res.text)));
      const call = res.toolCalls.find(
        (c) => c.name === "get_weather" && (c.arguments?.city ?? "").trim().length > 0,
      );
      if (call) console.log("QUEEN_TOOL_SMOKE_RESULT:\n" + (await runTool(call)));
    } catch (e) {
      console.error("QUEEN_TOOL_SMOKE_ERROR:", e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  })();
} else {
  render();
}
