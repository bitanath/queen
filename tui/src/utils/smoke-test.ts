import { generate } from "./queen-ffi";
import { createQueenAgent } from "../functions/tools-execution";
import { stripToolMarkup, weatherTool } from "../functions/tool-definitions";
import { getStatus, isNotLoggedIn, renderStatusMd } from "./bee-com-bridge";

const DEFAULT_PROMPT = "What is the weather in Tokyo?"; //TODO just a random prompt to test a random tool call

type Check = { name: string; run: (prompt: string) => Promise<string> | string };

const checks: Check[] = [
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
      const agent = createQueenAgent();
      const result = await agent.invoke(prompt);
      const stop = result.stopReason;
      if (stop === "cancelled") throw new Error("agent turn cancelled");
      return `stop=${stop} messages=${agent.messages.length}`;
    },
  },
  {
    name: "tool",
    run: async (prompt) => {
      const city = /weather in ([A-Za-z .'-]+)/i.exec(prompt)?.[1]?.trim() || "Tokyo";
      const out = String(await weatherTool.invoke({ city }));
      if (out.trim().length === 0) throw new Error("get_weather returned nothing");
      return `get_weather(${city}) → ${out.trim().split("\n")[0]?.slice(0, 60) ?? ""}`;
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

  const passed = checks.length - failed;
  console.log(`QUEEN_SMOKE: ${passed}/${checks.length} passed`);
  if (failed > 0) process.exitCode = 1;
}
