import { generate } from "./queen-ffi";
import { createQueenAgent } from "../functions/tools-execution";
import { stripToolMarkup, webFetch } from "../functions/tool-definitions";
import { getStatus, isNotLoggedIn, renderStatusMd } from "./bee-com-bridge";
import { getBeeMcpState, invokeBeeTool, startBeeMcp, stopBeeMcp } from "../libraries/bee-mcp";

// FIXME Runtime: the full smoke takes ~60s. The "agent" check is ~37s and  "generic chat" ~15s (local model generation)
const DEFAULT_PROMPT = "What is the weather in Tokyo?"; 

type Check = { name: string; run: (prompt: string) => Promise<string> | string };

const checks: Check[] = [
  {
    name: "mcp",
    run: async () => {
      await startBeeMcp();
      const state = getBeeMcpState();
      if (state.status !== "connected") {
        throw new Error(`mcp ${state.status}${state.error ? `: ${state.error}` : ""}`);
      }
      if (state.toolCount === 0) throw new Error("mcp connected but exposed no tools");
      // Round-trip one real tool call to prove spawn -> list -> call works.
      const res = await invokeBeeTool("bee_status");
      return `${state.toolCount} tools; bee_status -> ${JSON.stringify(res).slice(0, 80)}`;
    },
  },
  {
    name: "generic chat",
    run: (prompt) => {
      const text = stripToolMarkup(generate({ prompt })).trim();
      if (text.length === 0) throw new Error("empty response");
      return text.slice(0, 80).replace(/\s+/g, " ");
    },
  },
  {
    name: "agent",
    run: async (prompt) => {
      const agent = createQueenAgent(); //TODO just a random prompt to test a random tool call
      const result = await agent.invoke(prompt);
      const stop = result.stopReason;
      if (stop === "cancelled") throw new Error("agent turn cancelled");
      return `stop=${stop} messages=${agent.messages.length}`;
    },
  },
  {
    name: "tool",
    run: async () => {
      const url = "https://wttr.in/Tokyo?format=3";
      const out = String(await webFetch.invoke({ url }));
      if (out.trim().length === 0) throw new Error("web_fetch returned nothing");
      return `web_fetch(${url}) → ${out.trim().split("\n")[0]?.slice(0, 60) ?? ""}`;
    },
  },
  {
    name: "status",
    run: async () => {
      try {
        const s = await getStatus();
        return renderStatusMd(s).replace(/\n/g, " · ");
      } catch (e) {
        if (isNotLoggedIn(e)) return "not logged in (offline path OK)";
        throw e;
      }
    },
  },
];

export function smokeRequested(): boolean {
  return Boolean(process.env.QUEEN_SMOKE);
}

export async function runSmoke(): Promise<void> {
  const raw = process.env.QUEEN_SMOKE;
  const prompt = !raw || raw === "1" ? DEFAULT_PROMPT : raw;
  console.log(`QUEEN_SMOKE prompt: ${JSON.stringify(prompt)}`);

  let failed = 0;
  for (const check of checks) {
    const started = Date.now();
    try {
      const detail = await check.run(prompt);
      console.log(`  PASS  ${check.name.padEnd(13)} (${Date.now() - started}ms)  ${detail}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL  ${check.name.padEnd(13)} (${Date.now() - started}ms)  ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await stopBeeMcp(); // kill the spawned server so the process can exit

  const passed = checks.length - failed;
  console.log(`QUEEN_SMOKE: ${passed}/${checks.length} passed`);
  if (failed > 0) process.exitCode = 1;
}
