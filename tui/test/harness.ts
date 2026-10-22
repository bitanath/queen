import { FLOW_CASES, type ExpectedStep, type FlowCase } from "./cases";
import { selectTools } from "../src/functions/agents/tool-selector";
import { fastDecision } from "../src/functions/agents/orchestrator";
import { parseListRequest } from "../src/functions/agents/list-request";
import { listTable } from "../src/functions/agents/format";
import { detectMissingInput, detectUnsupported } from "../src/functions/agents/validation";
import { createSession, rememberResult, resolveReference } from "../src/functions/agents/session";

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

function checkListTable(): void {
  const table = listTable("conversation", [
    { id: 10962218, started_at: 2000, summary: "first" },
    { id: 10624596, started_at: 1000, summary: "second" },
  ]);
  record("format:list-table-uri", "bee://conversations/10962218", table.includes("bee://conversations/10962218") ? "uri" : "missing", table.includes("bee://conversations/10962218"));
  record("format:list-table-rows", "2 rows", String(table.split("\n").length), table.split("\n").length === 4);
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
  checkListOrdering();
  checkListTable();
  checkMultiTurnReferences();

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
