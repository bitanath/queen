import { AgentRunner } from "../src/functions/agents/runner";
import { createSession, rememberRecords } from "../src/functions/agents/session";
import type { SessionState } from "../src/functions/agents/types";

type Recorder = (testCase: string, expect: string, actual: string, pass: boolean) => void;

const records = [
  {
    id: 11,
    short_summary: "Planning Apple Watch LLM Livestream and the future of ambient computing",
    summary: "Planning Apple Watch LLM Livestream and the future of ambient computing",
    started_at: 2000,
  },
  {
    id: 22,
    short_summary: "Coffee chat",
    summary: "Coffee chat",
    started_at: 1000,
  },
];

function runnerFor(
  session: SessionState,
  calls: { name: string; args: Record<string, unknown> }[],
  mode: "tui" | "cli" = "tui",
): AgentRunner {
  return new AgentRunner({
    mode,
    session,
    deps: {
      ack: "Working on it…",
      loggedIn: async () => true,
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "bee_list_conversations") return JSON.stringify({ conversations: records });
        if (name === "bee_get_conversation") {
          const record = records.find((item) => item.id === Number(args["id"]));
          return JSON.stringify({ conversation: record });
        }
        throw new Error(`unexpected tool ${name}`);
      },
      decide: async () => {
        throw new Error("orchestrator should not run");
      },
    },
  });
}

export async function checkReferenceFlow(record: Recorder): Promise<void> {
  const session = createSession();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const runner = runnerFor(session, calls);

  const list = await runner.run("list my last 2 conversations");
  record(
    "flow:list",
    "2 conversations remembered",
    `${session.lastResult?.kind} ${session.lastResult?.items.length ?? 0}`,
    session.lastResult?.kind === "conversation" && session.lastResult.items.length === 2,
  );

  calls.length = 0;
  const second = await runner.run("Tell me about the second one");
  record("flow:second-id", "bee_get_conversation id=22", `${calls.at(-1)?.name} id=${String(calls.at(-1)?.args["id"])}`, calls.at(-1)?.name === "bee_get_conversation" && Number(calls.at(-1)?.args["id"]) === 22);
  record("flow:second-text", "Coffee chat", second.text, second.text.includes("Coffee chat"));
  record("flow:second-entity", "22", String(session.lastEntity?.id), session.lastEntity?.id === 22);

  calls.length = 0;
  const first = await runner.run("what about the first one?");
  record("flow:first-id", "bee_get_conversation id=11", `${calls.at(-1)?.name} id=${String(calls.at(-1)?.args["id"])}`, calls.at(-1)?.name === "bee_get_conversation" && Number(calls.at(-1)?.args["id"]) === 11);
  record("flow:first-text", "Planning Apple Watch", first.text, first.text.includes("Planning Apple Watch"));
  record("flow:first-entity", "11", String(session.lastEntity?.id), session.lastEntity?.id === 11);

  calls.length = 0;
  const that = await runner.run("tell me more about that");
  record("flow:that-id", "bee_get_conversation id=11", `${calls.at(-1)?.name} id=${String(calls.at(-1)?.args["id"])}`, calls.at(-1)?.name === "bee_get_conversation" && Number(calls.at(-1)?.args["id"]) === 11);
  record("flow:that-text", "Planning Apple Watch", that.text, that.text.includes("Planning Apple Watch"));

  calls.length = 0;
  const title = await runner.run("Tell me a gist of Planning Apple Watch LLM Livestream");
  record("flow:partial-title-id", "bee_get_conversation id=11", `${calls.at(-1)?.name} id=${String(calls.at(-1)?.args["id"])}`, calls.at(-1)?.name === "bee_get_conversation" && Number(calls.at(-1)?.args["id"]) === 11);
  record("flow:partial-title-text", "Planning Apple Watch", title.text, title.text.includes("Planning Apple Watch"));

  const shortSession = createSession();
  rememberRecords(shortSession, "conversation", [records[1]!]);
  const shortCalls: { name: string; args: Record<string, unknown> }[] = [];
  const shortRunner = runnerFor(shortSession, shortCalls);
  const missing = await shortRunner.run("Tell me about the second one");
  record("flow:second-out-of-range", "clarify", missing.clarification ?? missing.text, missing.clarification?.toLowerCase().includes("which item") === true);

  const cliSession = createSession();
  rememberRecords(cliSession, "conversation", records);
  const cliCalls: { name: string; args: Record<string, unknown> }[] = [];
  const cliRunner = runnerFor(cliSession, cliCalls, "cli");
  const cli = await cliRunner.run("Tell me about the second one");
  record("flow:cli-second", "Coffee chat", cli.text, cli.text.includes("Coffee chat"));

  record("flow:no-list-text", "table text", list.text, list.text.includes("bee://conversations/11"));
}
