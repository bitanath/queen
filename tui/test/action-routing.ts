import "@/mcp/beeTools";

import assert from "node:assert/strict";

import { decide } from "../src/functions/action/cli-menu";
import { AgentRunner, hydrateReference } from "../src/functions/agents/runner";
import { referenceContent, referenceLabel, targetLine } from "../src/functions/agents/reference-content";
import { fastDecision } from "../src/functions/agents/orchestrator";
import {
  createSession,
  rememberRecords,
  type ResolvedReference,
} from "../src/functions/agents/session";
import { selectTools } from "../src/functions/agents/tool-selector";
import type { StepResult } from "../src/functions/agents/types";
import { detectMissingInput, detectUnsupported } from "../src/functions/agents/validation";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

const ALARM_AT = Date.UTC(2026, 9, 23, 9, 0, 0);

function todoSession() {
  const session = createSession();
  rememberRecords(session, "todo", [
    { id: 41, text: "buy milk", created_at: 2000, completed: false, alarm_at: ALARM_AT },
    { id: 42, text: "call mum", created_at: 1000, completed: false },
  ]);
  return session;
}

function conversationSession() {
  const session = createSession();
  rememberRecords(session, "conversation", [
    { id: 11, short_summary: "Alpha chat", started_at: 2000 },
    { id: 22, short_summary: "Beta chat", started_at: 1000 },
  ]);
  return session;
}

function listStep(agent: "bee_list" | "bee_read", text: string): StepResult {
  return {
    agent,
    prompt: "previous step",
    family: agent === "bee_list" ? "todos" : "conversation",
    tools: agent === "bee_list" ? ["bee_list_todos"] : ["bee_get_conversation"],
    text,
    ...(agent === "bee_read" ? { direct: true } : {}),
  };
}

function referenceFor(session: ReturnType<typeof todoSession>, id: number): ResolvedReference {
  const item = session.lastResult?.items.find((candidate) => candidate.id === id);
  assert.ok(item, `missing session item ${id}`);
  return { id, kind: item.kind, title: item.title, item, source: "ordinal" };
}

async function main(): Promise<void> {
  console.log("single-turn / CLI (empty session)");
  check("create a reminder from the first one asks for the item", () => {
    const decision = fastDecision("create a reminder from the first one", createSession(), []);
    assert.equal(decision?.agent, "done");
    assert.equal(decision?.clarify, true);
    assert.match(decision?.prompt ?? "", /Include the item text or a bee:\/\//);
  });
  check("create a reminder from the first todo remains self-contained", () => {
    const decision = fastDecision("create a reminder from the first todo", createSession(), []);
    assert.equal(decision?.agent, "bee_list");
    assert.equal(decision?.final, false);
  });
  check("complete the first todo lists first, then writes", () => {
    const first = fastDecision("complete the first todo", createSession(), []);
    assert.equal(first?.agent, "bee_list");
    const second = fastDecision("complete the first todo", todoSession(), [listStep("bee_list", "1. buy milk")]);
    assert.equal(second?.agent, "bee_write");
    assert.match(second?.prompt ?? "", /id=41/);
  });
  check("a URI is a self-contained target", () => {
    const decision = fastDecision("create a reminder from bee://todos/29249989", createSession(), []);
    assert.equal(decision?.agent, "os_action");
    assert.equal(String(decision?.reference?.id), "29249989");
  });
  check("CLI decide keeps direct commands", () => {
    assert.equal(decide("todos create --text \"buy milk\"").kind, "subcommand");
    assert.equal(decide("todos list").kind, "subcommand");
    assert.equal(decide("bee://todos/29249989").kind, "uri");
  });
  check("CLI decide sends free text to the agent", () => {
    assert.equal(decide("create a reminder from the first one").kind, "agent");
    assert.equal(decide("make a note of the first todo").kind, "agent");
  });

  console.log("multi-turn (TUI session)");
  check("reminder from the first todo targets the right id", () => {
    const decision = fastDecision("create a reminder from the first one", todoSession(), []);
    assert.equal(decision?.agent, "os_action");
    assert.equal(decision?.reference?.id, 41);
    assert.match(decision?.prompt ?? "", /Target item: id=41/);
  });
  check("note from this todo targets the current item", () => {
    const decision = fastDecision("make a note of this todo", todoSession(), []);
    assert.equal(decision?.agent, "os_action");
    assert.equal(decision?.reference?.id, 41);
  });
  check("clipboard from this resolves to an OS action", () => {
    const decision = fastDecision("put this on my clipboard", todoSession(), []);
    assert.equal(decision?.agent, "os_action");
    assert.equal(decision?.reference?.id, 41);
  });
  check("calendar gets the target title without asking for it", () => {
    const session = todoSession();
    const decision = fastDecision("add a calendar event from the first one", session, []);
    assert.equal(decision?.agent, "os_action");
    const missing = detectMissingInput(
      "os_action",
      "add a calendar event from the first one",
      session,
      referenceFor(session, 41),
    );
    assert.equal(missing, undefined);
  });
  check("mail still asks for the recipient when missing", () => {
    const session = todoSession();
    const missing = detectMissingInput(
      "os_action",
      "draft an email about the first one",
      session,
      referenceFor(session, 41),
    );
    assert.match(missing?.question ?? "", /email address/);
    const withAddress = detectMissingInput(
      "os_action",
      "draft an email about the first one to bob@example.com",
      session,
      referenceFor(session, 41),
    );
    assert.equal(withAddress, undefined);
  });
  check("alarm/rename use Bee write, not Bee read", () => {
    const alarm = fastDecision("set an alarm on the first one", todoSession(), []);
    assert.equal(alarm?.agent, "bee_write");
    assert.equal(alarm?.reference?.id, 41);
    const rename = fastDecision("rename the second one to groceries", todoSession(), []);
    assert.equal(rename?.agent, "bee_write");
    assert.equal(rename?.reference?.id, 42);
  });
  check("reading a todo reference stays a read", () => {
    const decision = fastDecision("tell me more about the second one", todoSession(), []);
    assert.equal(decision?.agent, "bee_read");
    assert.equal(decision?.reference?.id, 42);
    assert.equal(decision?.final, true);
  });
  check("latest todo resolves for an implicit reminder", () => {
    const decision = fastDecision("The reminder is for my latest TODO", todoSession(), []);
    assert.equal(decision?.agent, "os_action");
    assert.equal(decision?.reference?.id, 41);
  });

  console.log("post-list continuation and content reads");
  check("a two-item note keeps both items", () => {
    const decision = fastDecision(
      "create a note from my last 2 todos",
      todoSession(),
      [listStep("bee_list", "1. buy milk\n2. call mum")],
    );
    assert.equal(decision?.agent, "os_action");
    assert.match(decision?.prompt ?? "", /buy milk/);
    assert.match(decision?.prompt ?? "", /call mum/);
    assert.doesNotMatch(decision?.prompt ?? "", /Target item:/);
  });
  check("a conversation content action reads first", () => {
    const decision = fastDecision(
      "draft an email to bob@example.com about the first conversation",
      conversationSession(),
      [],
    );
    assert.equal(decision?.agent, "bee_read");
    assert.equal(decision?.final, false);
    assert.equal(decision?.reference?.id, 11);
  });
  check("after the content read, the OS action gets the text", () => {
    const decision = fastDecision(
      "draft an email to bob@example.com about the first conversation",
      conversationSession(),
      [listStep("bee_read", "Alpha chat body")],
    );
    assert.equal(decision?.agent, "os_action");
    assert.match(decision?.prompt ?? "", /Alpha chat body/);
  });

  console.log("selection and validation are not polluted by data titles");
  check("reminder selection has only reminder tools", () => {
    const selected = selectTools("os_action", "create a reminder from the first one", {
      kinds: ["todo"],
    });
    assert.ok(selected.tools.includes("os_add_reminder"));
    assert.ok(!selected.tools.includes("os_mail_draft"));
    assert.ok(!selected.tools.includes("os_open_app"));
  });
  check("alarm selection reaches the todo write tool", () => {
    const selected = selectTools("bee_write", "set an alarm on the first one", {
      kinds: ["todo"],
    });
    assert.ok(selected.tools.includes("bee_update_todo"));
  });
  check("empty reminder asks for its subject", () => {
    const missing = detectMissingInput("os_action", "create a reminder", createSession());
    assert.match(missing?.question ?? "", /remind you about/);
  });
  check("reminder reads remain unsupported", () => {
    assert.ok(detectUnsupported("list my reminders"));
    assert.ok(detectUnsupported("what reminders do I have"));
  });

  console.log("hydration and runner regressions");
  await checkAsync("a URI-only todo is hydrated by id", async () => {
    const session = createSession();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const hydrated = await hydrateReference(
      { id: 29249989, kind: "todo", source: "uri" },
      session,
      undefined,
      {},
      {
        loggedIn: async () => true,
        callTool: async (name, args) => {
          calls.push({ name, args });
          return JSON.stringify({
            todos: [{ id: 29249989, text: "Check your social media story insights" }],
          });
        },
      },
    );
    assert.equal(hydrated.title, "Check your social media story insights");
    assert.equal(calls[0]?.name, "bee_list_todos");
  });

  await checkAsync("TUI reading a listed todo does not call tools", async () => {
    const session = todoSession();
    const calls: string[] = [];
    const runner = new AgentRunner({
      mode: "tui",
      session,
      deps: {
        ack: "Working on it…",
        loggedIn: async () => true,
        decide: async () => {
          throw new Error("orchestrator should not run");
        },
        callTool: async (name) => {
          calls.push(name);
          throw new Error(`unexpected tool ${name}`);
        },
      },
    });
    const turn = await runner.run("tell me more about the second one");
    assert.match(turn.text, /call mum/);
    assert.match(turn.text, /bee:\/\/todos\/42/);
    assert.deepEqual(calls, []);
  });

  await checkAsync("planned OS transfers bypass the model and carry item details", async () => {
    const session = todoSession();
    const runner = new AgentRunner({
      mode: "cli",
      session,
      deps: {
        ack: "Working on it…",
        loggedIn: async () => true,
        decide: async () => {
          throw new Error("orchestrator should not run");
        },
        callTool: async (name) => {
          throw new Error(`unexpected tool ${name}`);
        },
      },
    });
    const expectedLabel = referenceLabel("todo", "buy milk");

    const reminder = await runner.run("create a reminder from the first one");
    assert.equal(reminder.approval?.tool, "os_add_reminder");
    assert.equal(reminder.approval?.args["title"], "buy milk");
    assert.equal(reminder.approval?.args["due"], new Date(ALARM_AT).toISOString());
    assert.match(String(reminder.approval?.args["body"]), /status: open/);
    assert.match(String(reminder.approval?.args["body"]), /source: bee:\/\/todos\/41/);

    const note = await runner.run("make a note of this todo");
    assert.equal(note.approval?.tool, "os_create_note");
    assert.equal(note.approval?.args["title"], expectedLabel);
    const noteBody = String(note.approval?.args["body"]);
    assert.equal(noteBody.split("buy milk").length - 1, 1);
    assert.match(noteBody, /status: open/);
    assert.match(noteBody, /created:/);
    assert.match(noteBody, /alarm:/);
    assert.match(noteBody, /source: bee:\/\/todos\/41/);
    assert.ok(!noteBody.includes("**"));
    assert.notEqual(note.approval?.args["body"], note.approval?.args["title"]);

    const clipboard = await runner.run("put this on my clipboard");
    assert.equal(clipboard.approval?.tool, "os_clipboard_set");
    const clipboardText = String(clipboard.approval?.args["text"]);
    assert.equal(clipboardText.split("buy milk").length - 1, 1);
    assert.ok(clipboardText.includes(expectedLabel));
    assert.match(clipboardText, /status: open/);
    assert.match(clipboardText, /source: bee:\/\/todos\/41/);
    assert.ok(!clipboardText.includes("**"));

    const content = referenceContent(referenceFor(session, 41), session);
    assert.notEqual(content.label, content.oneLine);
    assert.match(content.oneLine, /buy milk/);
    assert.match(content.oneLine, /open/);
  });

  check("model OS prompts include item details", () => {
    const session = todoSession();
    const decision = fastDecision("draft an email about these todos to bob@example.com", session, []);
    assert.equal(decision?.agent, "os_action");
    assert.match(decision?.prompt ?? "", /status: open/);
    assert.match(decision?.prompt ?? "", /source: bee:\/\/todos\/41/);
    assert.match(decision?.prompt ?? "", /source: bee:\/\/todos\/42/);

    const target = targetLine(referenceFor(session, 41), session);
    assert.match(target, /Target details:/);
    assert.match(target, /status: open/);
    assert.match(target, /source: bee:\/\/todos\/41/);
  });

  await checkAsync("plural note transfers include details for every item", async () => {
    const session = todoSession();
    const runner = new AgentRunner({
      mode: "cli",
      session,
      deps: {
        ack: "Working on it…",
        loggedIn: async () => true,
        decide: async () => {
          throw new Error("orchestrator should not run");
        },
        callTool: async (name) => {
          throw new Error(`unexpected tool ${name}`);
        },
      },
    });
    const note = await runner.run("create a note from these todos");
    assert.equal(note.approval?.tool, "os_create_note");
    assert.match(String(note.approval?.args["title"]), /Todos/);
    const body = String(note.approval?.args["body"]);
    assert.equal(body.split("buy milk").length - 1, 1);
    assert.equal(body.split("call mum").length - 1, 1);
    assert.match(body, /status: open/);
    assert.match(body, /source: bee:\/\/todos\/41/);
    assert.match(body, /source: bee:\/\/todos\/42/);
    assert.ok(!body.includes("##"));
  });

  await checkAsync("CLI list + direct conversation read still work", async () => {
    const conversations = [
      { id: 11, short_summary: "Alpha chat", started_at: 2000 },
      { id: 22, short_summary: "Beta chat", started_at: 1000 },
    ];
    const session = createSession();
    const calls: string[] = [];
    const runner = new AgentRunner({
      mode: "cli",
      session,
      deps: {
        ack: "Working on it…",
        loggedIn: async () => true,
        decide: async () => {
          throw new Error("orchestrator should not run");
        },
        callTool: async (name, args) => {
          calls.push(name);
          if (name === "bee_list_conversations") return JSON.stringify({ conversations });
          if (name === "bee_get_conversation") {
            return JSON.stringify({
              conversation: conversations.find((item) => item.id === Number(args["id"])),
            });
          }
          throw new Error(`unexpected tool ${name}`);
        },
      },
    });
    const list = await runner.run("list my last 2 conversations");
    assert.match(list.text, /bee:\/\/conversations\/11/);
    const read = await runner.run("Tell me about the second one");
    assert.equal(read.text, "Beta chat");
    assert.ok(calls.includes("bee_list_conversations"));
    assert.ok(calls.includes("bee_get_conversation"));
  });

  console.log(`\nACTION ROUTING: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exitCode = 1;
}

await main(); //FIXME: Just a unit test no biggie
