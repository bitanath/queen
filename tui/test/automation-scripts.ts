import assert from "node:assert/strict";

import { MACOS_AUTOMATIONS } from "../src/functions/automation/macos";

const originalSpawn = Bun.spawn;

async function captureSpawn(run: () => Promise<unknown>): Promise<string[]> {
  let captured: string[] = [];
  (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd: string[]) => {
    captured = cmd;
    return {
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(0),
    };
  }) as unknown as typeof Bun.spawn;
  try {
    await run();
  } finally {
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
  }
  return captured;
}

const reminder = MACOS_AUTOMATIONS.find((candidate) => candidate.name === "os_add_reminder");
assert.ok(reminder, "os_add_reminder is missing");

const cmd = await captureSpawn(() =>
  reminder.run({ title: "buy milk", due: "2026-10-23T09:00:00", body: "status: open\nsource: bee://todos/41" }),
);
const script = cmd[cmd.indexOf("-e") + 1] ?? "";

assert.match(script, /a\.Reminder\(/);
assert.doesNotMatch(script, /a\.Reminders\(/);
assert.match(script, /p\.body=argv\[2\]/);
assert.ok(cmd.includes("buy milk"));
assert.ok(cmd.includes("2026-10-23T09:00:00"));
assert.ok(cmd.includes("status: open\nsource: bee://todos/41"));

const calendar = MACOS_AUTOMATIONS.find((candidate) => candidate.name === "os_add_calendar_event");
assert.ok(calendar, "os_add_calendar_event is missing");

const calendarCmd = await captureSpawn(() =>
  calendar.run({
    title: "Queen test event",
    start: "2026-10-23T09:00:00",
    end: "2026-10-23T10:00:00",
    description: "status: open\nsource: bee://todos/41",
  }),
);
const calendarScript = calendarCmd[calendarCmd.indexOf("-e") + 1] ?? "";

assert.match(calendarScript, /p\.description=argv\[3\]/);
assert.ok(calendarCmd.includes("status: open\nsource: bee://todos/41"));

const note = MACOS_AUTOMATIONS.find((candidate) => candidate.name === "os_create_note");
assert.ok(note, "os_create_note is missing");

const noteCmd = await captureSpawn(() =>
  note.run({ title: "💬 Social Todo", body: "buy milk\n\nstatus: open" }),
);
const noteScript = noteCmd[noteCmd.indexOf("-e") + 1] ?? "";

assert.ok(noteScript.includes('replace(/\\n/g,"<br>")'));
assert.ok(noteCmd.includes("buy milk\n\nstatus: open"));

console.log("  PASS  reminder, calendar and note JXA pass body details without repeating the title"); //FIXME: - automating a script for a unit test
