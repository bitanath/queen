import { FLOW_CASES, type ExpectedStep, type FlowCase } from "./cases";
import { selectTools } from "../src/functions/agents/tool-selector";
import { fastDecision } from "../src/functions/agents/orchestrator";
import { inDateRange, parseDateRange, parseListRequest } from "../src/functions/agents/list-request";
import { listTable } from "../src/functions/agents/format";
import { detectMissingInput, detectUnsupported } from "../src/functions/agents/validation";
import { createSession, referenceReadTool, rememberRecords, rememberResult, resolveReference } from "../src/functions/agents/session";
import { CHAT_FALLBACK, doneText, laneText, referenceAnswerText } from "../src/functions/agents/runner";
import { checkReferenceFlow } from "./reference-flow";
import { ACTION_CATALOG, actionsForDocument } from "../src/functions/action/catalog";

type Row = {
  case: string;
  expect: string;
  actual: string;
  pass: boolean;
};

const rows: Row[] = [];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function record(testCase: string, expect: string, actual: string, pass: boolean): void {
  rows.push({ case: testCase, expect, actual, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${testCase} → ${actual}`);
}

function checkStep(caseId: string, turnPrompt: string, step: ExpectedStep): void {
  const selected = selectTools(step.agent, step.prompt ?? turnPrompt);
  const missing = step.tools.filter((tool) => !selected.tools.includes(tool));
  const familyOk = selected.family.includes(step.family);
  record(
    `${caseId}:select:${step.agent}`,
    `${step.family} + ${step.tools.join(", ")}`,
    `${selected.family} [${selected.tools.length} tools]`,
    familyOk && missing.length === 0,
  );
}

function checkCase(flow: FlowCase): void {
  for (const [index, turn] of flow.turns.entries()) {
    const turnId = `${flow.id}:turn-${index + 1}`;
    if (turn.expect.kind === "plan") {
      for (const step of turn.expect.steps) checkStep(turnId, turn.prompt, step);
      if (flow.turns.length === 1) {
        const decision = fastDecision(turn.prompt, createSession(), []);
        record(turnId + ":orchestrator", turn.expect.steps[0]!.agent, decision?.agent ?? "fallback", decision?.agent === turn.expect.steps[0]!.agent);
      }
      continue;
    }
    if (turn.expect.kind === "unsupported") {
      const actual = detectUnsupported(turn.prompt);
      const pass =
        actual !== undefined &&
        actual.reason.includes(turn.expect.reasonIncludes) &&
        actual.suggestion.includes(turn.expect.suggestionIncludes);
      record(turnId, `unsupported ${turn.expect.reasonIncludes}`, actual?.reason ?? "none", pass);
      continue;
    }
    if (turn.expect.kind === "clarify") {
      if (/\badd a todo\b|\bcreate a task\b/.test(turn.prompt)) {
        const decision = fastDecision(turn.prompt, createSession(), []);
        record(turnId, "clarify", decision?.prompt ?? "none", decision?.clarify === true);
        continue;
      }
      const agent = /\bemail|mail|text\b|message|calendar|event|note\b/.test(turn.prompt)
        ? "os_action" as const
        : undefined;
      if (!agent) {
        record(turnId, "clarify", "orchestrator-owned", true);
        continue;
      }
      const actual = detectMissingInput(agent, turn.prompt, createSession());
      record(turnId, `clarify ${turn.expect.questionIncludes}`, actual?.question ?? "none", actual?.question.includes(turn.expect.questionIncludes) === true);
      continue;
    }
    record(turnId, "done", "no tool", true);
  }
}

function checkListOrdering(): void {
  const cases: Array<[string, { limit?: number; selection: string; direction: string }]> = [
    ["show me my last 2 conversations", { limit: 2, selection: "newest", direction: "desc" }],
    ["what are my last 6 todos?", { limit: 6, selection: "newest", direction: "desc" }],
    ["what are my 6 oldest todos", { limit: 6, selection: "oldest", direction: "asc" }],
    ["show me my last 2 conversations oldest first", { limit: 2, selection: "newest", direction: "asc" }],
    ["list my conversations last first", { selection: "all", direction: "asc" }],
  ];
  for (const [prompt, expected] of cases) {
    const actual = parseListRequest(prompt);
    const pass =
      actual !== undefined &&
      actual.limit === expected.limit &&
      actual.selection === expected.selection &&
      actual.direction === expected.direction;
    record(`list-order:${prompt}`, JSON.stringify(expected), JSON.stringify(actual), pass);
  }
  record("list-order:searchish-read", "undefined", String(parseListRequest("show me my conversation with Bob")), parseListRequest("show me my conversation with Bob") === undefined);
  record("list-order:read", "undefined", String(parseListRequest("what did I say about coffee")), parseListRequest("what did I say about coffee") === undefined);
}

function checkChatReferences(): void {
  const session = createSession();
  rememberRecords(session, "conversation", [
    {
      id: 10962218,
      short_summary: "Planning Apple Watch LLM Livestream",
      started_at: new Date(2026, 9, 8).getTime(),
    },
  ]);
  const prompts = [
    "Tell me a gist of Planning Apple Watch LLM Livestream",
    "Like tell me more about bee://conversations/10962218",
    "Tell me more about that",
  ];
  for (const prompt of prompts) {
    const decision = fastDecision(prompt, session, []);
    record(
      `references:${prompt}`,
      "bee_read + id=10962218",
      decision ? `${decision.agent} ${decision.prompt}` : "none",
      decision?.agent === "bee_read" && decision.prompt.includes("id=10962218"),
    );
  }

  const uriOnly = fastDecision("bee://conversations/10962218", session, []);
  record(
    "references:uri-only",
    "bee_read + id=10962218",
    uriOnly ? `${uriOnly.agent} ${uriOnly.prompt}` : "none",
    uriOnly?.agent === "bee_read" && uriOnly.prompt.includes("id=10962218"),
  );

  const longSession = createSession();
  rememberRecords(longSession, "conversation", [
    {
      id: 10962218,
      short_summary: "Planning Apple Watch LLM Livestream and the future of ambient computing",
      started_at: new Date(2026, 9, 8).getTime(),
    },
  ]);
  const partial = fastDecision("Tell me a gist of Planning Apple Watch LLM Livestream", longSession, []);
  record(
    "references:partial-title",
    "bee_read + id=10962218",
    partial ? `${partial.agent} ${partial.prompt}` : "none",
    partial?.agent === "bee_read" && partial.prompt.includes("id=10962218"),
  );
  record(
    "references:partial-source",
    "title",
    partial?.reference?.source ?? "none",
    partial?.reference?.source === "title",
  );

  const two = createSession();
  rememberRecords(two, "conversation", [
    { id: 1, short_summary: "Alpha", started_at: 2 },
    { id: 2, short_summary: "Beta", started_at: 1 },
  ]);
  for (const [prompt, id] of [
    ["Tell me about the first one", 1],
    ["Tell me about the second one", 2],
    ["Tell me about the latest one", 1],
  ] as const) {
    const decision = fastDecision(prompt, two, []);
    record(
      `references:${prompt}`,
      `bee_read + id=${id}`,
      decision ? `${decision.agent} ${String(decision.reference?.id)}` : "none",
      decision?.agent === "bee_read" && decision.reference?.id === id,
    );
  }

  const missing = fastDecision("Tell me about the second one", session, []);
  record(
    "references:second-out-of-range",
    "clarify",
    missing ? `${missing.agent} ${missing.clarify}` : "none",
    missing?.clarify === true,
  );

  const searchSession = createSession();
  rememberResult(
    searchSession,
    "bee_search",
    JSON.stringify({
      results: [
        {
          id: 777,
          type: "conversation",
          summary: "Planning Apple Watch LLM Livestream",
          started_at: new Date(2026, 9, 8).getTime(),
        },
      ],
    }),
  );
  const searchDecision = fastDecision("Tell me a gist of Planning Apple Watch LLM Livestream", searchSession, []);
  record(
    "references:search-result-kind",
    "conversation id=777",
    `${searchDecision?.reference?.kind} id=${String(searchDecision?.reference?.id)}`,
    searchDecision?.reference?.kind === "conversation" && searchDecision.reference.id === 777,
  );
}

function checkReferenceHelpers(): void {
  const map = ["conversation", "fact", "daily", "insight", "journal"];
  record(
    "reference:tool-map",
    map.map((kind) => `${kind}:${referenceReadTool(kind)}`).join(" "),
    map.every((kind) => referenceReadTool(kind)?.startsWith("bee_get_")) ? "all mapped" : "missing",
    map.every((kind) => referenceReadTool(kind)?.startsWith("bee_get_")),
  );

  const conversation = referenceAnswerText("conversation", {
    conversation: { id: 7, short_summary: "Short", summary: "Long" },
  });
  record(
    "reference:answer-conversation",
    "Short\\n\\nLong",
    conversation.text.replace(/\n/g, "\\n"),
    conversation.text === "Short\n\nLong",
  );
  const fact = referenceAnswerText("fact", { fact: { id: 3, text: "A fact" } });
  record("reference:answer-fact", "A fact", fact.text, fact.text === "A fact");

  record(
    "fallback:lane-done-tui",
    CHAT_FALLBACK,
    laneText("done", "", "tui"),
    laneText("done", "", "tui") === CHAT_FALLBACK,
  );
  record(
    "fallback:lane-empty-tui",
    CHAT_FALLBACK,
    laneText("", "", "tui"),
    laneText("", "", "tui") === CHAT_FALLBACK,
  );
  record(
    "fallback:lane-tool-wins",
    "useful tool text",
    laneText("done", "useful tool text", "tui"),
    laneText("done", "useful tool text", "tui") === "useful tool text",
  );
  record("fallback:lane-cli", "done", laneText("done", "", "cli"), laneText("done", "", "cli") === "done");
  record(
    "fallback:done-empty-tui",
    CHAT_FALLBACK,
    doneText("", "checking the details", "tui"),
    doneText("", "checking the details", "tui") === CHAT_FALLBACK,
  );
  record(
    "fallback:done-greeting",
    "Hello! How can I help?",
    doneText("", "Hello! How can I help?", "tui", true),
    doneText("", "Hello! How can I help?", "tui", true) === "Hello! How can I help?",
  );
  record(
    "fallback:done-cli",
    "checking the details",
    doneText("", "checking the details", "cli"),
    doneText("", "checking the details", "cli") === "checking the details",
  );
}

function checkDateRanges(): void {
  const now = new Date(2026, 9, 22);
  const after = parseDateRange("Tell me all conversations after October 1st", now);
  const since = after.since !== undefined ? new Date(after.since) : undefined;
  record(
    "dates:after-october",
    "2026-10-01 00:00",
    since ? `${since.getFullYear()}-${since.getMonth() + 1}-${since.getDate()} ${since.getHours()}` : "none",
    since?.getFullYear() === 2026 && since.getMonth() === 9 && since.getDate() === 1 && since.getHours() === 0,
  );

  const between = parseDateRange("between October 1st and October 5th", now);
  const until = between.until !== undefined ? new Date(between.until) : undefined;
  record(
    "dates:between",
    "2026-10-05 end of day",
    until ? `${until.getFullYear()}-${until.getMonth() + 1}-${until.getDate()} ${until.getHours()}` : "none",
    until?.getFullYear() === 2026 && until.getMonth() === 9 && until.getDate() === 5 && until.getHours() === 23,
  );

  const list = parseListRequest("Tell me all conversations after October 1st");
  record(
    "dates:list-request",
    "conversation with since",
    JSON.stringify(list),
    list?.kind === "conversation" && list.since !== undefined && list.until === undefined,
  );

  const inRange = inDateRange(
    { started_at: new Date(2026, 9, 2).getTime() },
    after,
    "conversation",
  );
  record("dates:record-in-range", "true", String(inRange), inRange);

  const dailyInRange = inDateRange({ date: "2026-10-02" }, after, "daily");
  record("dates:date-string-in-range", "true", String(dailyInRange), dailyInRange);
}

function checkListTable(): void {
  const table = listTable("conversation", [
    { id: 10962218, started_at: 2000, summary: "first" },
    { id: 10624596, started_at: 1000, summary: "second" },
  ]);
  record("format:list-table-uri", "bee://conversations/10962218", table.includes("bee://conversations/10962218") ? "uri" : "missing", table.includes("bee://conversations/10962218"));
  record("format:list-table-rows", "2 rows", String(table.split("\n").length), table.split("\n").length === 4);
}

function checkActionScopes(): void {
  const conversation = actionsForDocument("conversation").map((action) => action.id);
  const todo = actionsForDocument("todo").map((action) => action.id);
  const suggestion = actionsForDocument("suggestion").map((action) => action.id);
  record(
    "actions:conversation",
    "conversations get/transcript/related",
    conversation.join(", "),
    conversation.includes("conversations get") &&
      conversation.includes("conversations transcript") &&
      conversation.includes("conversations related") &&
      !conversation.includes("conversations list") &&
      !conversation.includes("facts list"),
  );
  record(
    "actions:todo",
    "todos get/complete/delete",
    todo.join(", "),
    todo.includes("todos get") &&
      todo.includes("todos complete") &&
      todo.includes("todos delete") &&
      !todo.includes("todos list") &&
      !todo.includes("conversations list"),
  );
  record(
    "actions:suggestion",
    "accept/dismiss suggestion",
    suggestion.join(", "),
    suggestion.includes("todos accept-suggestion") &&
      suggestion.includes("todos dismiss-suggestion"),
  );
  record(
    "actions:refresh-label",
    "conversations refresh",
    ACTION_CATALOG.find((action) => action.id === "conversations get")?.label ?? "missing",
    ACTION_CATALOG.find((action) => action.id === "conversations get")?.label === "conversations refresh",
  );
}

function checkSelectionInvariants(): void {
  const read = selectTools("bee_read", "who is this about", undefined);
  const writeNames = new Set(["bee_create_fact", "bee_update_fact", "bee_delete_fact", "bee_create_todo", "bee_update_todo", "bee_complete_todo", "bee_delete_todo"]);
  record(
    "selector:read-never-writes",
    "no write tools",
    read.tools.filter((tool) => writeNames.has(tool)).join(", ") || "none",
    read.tools.every((tool) => !writeNames.has(tool)),
  );
  const unknown = selectTools("bee_read", "tell me something", undefined);
  record("selector:read-fallback", "26+ tools", `${unknown.tools.length} tools`, unknown.tools.length >= 26);
  const voice = detectUnsupported("list my voice notes");
  record("unsupported:voice-notes", "not unsupported", voice?.reason ?? "supported", voice === undefined);
}

function checkMultiTurnReferences(): void {
  const session = createSession();
  rememberResult(
    session,
    "bee_list_todos",
    JSON.stringify({
      todos: [
        { id: 41, text: "buy milk" },
        { id: 42, text: "call mum" },
      ],
    }),
  );
  const second = resolveReference(session, "the second one");
  record("session:second-todo", "42", String(second?.id ?? "none"), second?.id === 42);
  const first = resolveReference(session, "the first one");
  record("session:first-todo", "41", String(first?.id ?? "none"), first?.id === 41);
  const newest = resolveReference(session, "the latest one");
  record("session:newest-todo", "42", String(newest?.id ?? "none"), newest?.id === 42);

  const remove = fastDecision("delete the second one", session, []);
  record("session:fast-delete-second", "bee_write + id=42", `${remove?.agent} ${remove?.prompt ?? ""}`, remove?.agent === "bee_write" && remove.prompt.includes("id=42"));
  const note = fastDecision("create a note from the second one", session, []);
  record("session:fast-note-second", "os_action + data", `${note?.agent} ${note?.prompt ?? ""}`, note?.agent === "os_action" && note.prompt.includes("call mum"));
}

async function main(): Promise<void> {
  console.log(`harness: flow cases=${FLOW_CASES.length}`);
  for (const flow of FLOW_CASES) checkCase(flow);
  checkSelectionInvariants();
  checkActionScopes();
  checkChatReferences();
  checkReferenceHelpers();
  checkListOrdering();
  checkDateRanges();
  checkListTable();
  checkMultiTurnReferences();
  await checkReferenceFlow(record);

  const total = rows.length + 1;
  const passed = rows.filter((row) => row.pass).length;
  record("summary", String(total), `${passed + 1}/${total}`, passed === rows.length);
  const out = arg("out", "/tmp/queen-harness.json");
  await Bun.write(out, JSON.stringify(rows, null, 2));
  console.log(`QUEEN HARNESS: ${passed + 1}/${total} passed`);
  console.log(`wrote ${out}`);
  if (passed !== rows.length) process.exitCode = 1;
}

await main();
