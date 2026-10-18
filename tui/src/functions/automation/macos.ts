import { exec, execOrThrow, execStdin, optStr, str } from "./exec";
import type { AutomationDef } from "./types";

async function jxa(body: string, argv: string[]): Promise<string> {
  return execOrThrow(
    ["osascript", "-l", "JavaScript", "-e", `function run(argv){${body}}`, "--", ...argv],
    "osascript",
  ); //TODO run a JXA using osascript, this is considerably less buggy than using applescript like who on earth came up with that shiiii
}

/** Run an AppleScript `on run argv` handler with argv passed after `--`. */
async function osa(lines: string[], argv: string[]): Promise<string> {
  const cmd = ["osascript", "-e", "on run argv"];
  for (const line of lines) cmd.push("-e", line);
  cmd.push("-e", "end run", "--", ...argv);
  return execOrThrow(cmd, "osascript");
}

async function osaDirect(script: string): Promise<string> {
  return execOrThrow(["osascript", "-e", script], "osascript");
}

export const MACOS_AUTOMATIONS: AutomationDef[] = [
  {
    name: "os_open_url",
    description: "Open a URL in the user's default browser.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    run: async (input) => execOrThrow(["open", str(input, "url")], "open"),
  },
  {
    name: "os_open_app",
    description: "Launch a macOS app by name (e.g. \"Safari\", \"Calendar\").",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: async (input) => execOrThrow(["open", "-a", str(input, "name")], "open"),
  },
  {
    name: "os_show_location",
    description: "Show a place on the map in Apple Maps.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    run: async (input) => execOrThrow(["open", `maps://?q=${encodeURIComponent(str(input, "query"))}`], "maps"),
  },
  {
    name: "os_directions",
    description: "Open driving directions between two places in Apple Maps.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["to"],
    },
    run: async (input) => {
      const to = encodeURIComponent(str(input, "to"));
      const from = optStr(input, "from");
      const url = from ? `maps://?saddr=${encodeURIComponent(from)}&daddr=${to}` : `maps://?daddr=${to}`;
      return execOrThrow(["open", url], "maps");
    },
  },
  {
    name: "os_add_reminder",
    description: "Add a reminder to Reminders.app. `due` is an ISO date-time (optional).",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, due: { type: "string" } },
      required: ["title"],
    },
    run: async (input) => {
      const title = str(input, "title");
      const due = optStr(input, "due") ?? "";
      return jxa(
        'var a=Application("Reminders");var l=a.defaultList();var r=a.Reminders({name:argv[0]});' +
          'if(argv[1]){r.dueDate=new Date(argv[1]);}l.reminders.push(r);return "Reminder added.";',
        [title, due],
      );
    },
  },
  {
    name: "os_add_calendar_event",
    description: "Create a calendar event. `start`/`end` are ISO date-times (end optional).",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" } },
      required: ["title", "start"],
    },
    run: async (input) => {
      const title = str(input, "title");
      const start = str(input, "start");
      const end = optStr(input, "end") ?? start;
      return jxa(
        'var a=Application("Calendar");var c=a.calendars[0];' +
          "var e=a.Event({summary:argv[0],startDate:new Date(argv[1]),endDate:new Date(argv[2])});" +
          'c.events.push(e);return "Event added.";',
        [title, start, end],
      );
    },
  },
  {
    name: "os_create_note",
    description: "Create a note in Notes.app.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
      required: ["title"],
    },
    run: async (input) =>
      jxa(
        'var a=Application("Notes");var n=a.Note({name:argv[0],body:argv[1]||""});' +
          'a.defaultAccount().notes.push(n);return "Note created.";',
        [str(input, "title"), optStr(input, "body") ?? ""],
      ),
  },
  {
    name: "os_add_contact",
    description: "Add a contact to Contacts.app.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        first: { type: "string" },
        last: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
      },
      required: ["first"],
    },
    run: async (input) =>
      jxa(
        'var a=Application("Contacts");var p=a.Person({firstName:argv[0],lastName:argv[1]||""});' +
          'if(argv[2]){p.phones.push(a.Phone({label:"mobile",value:argv[2]}));}' +
          'if(argv[3]){p.emails.push(a.Email({label:"home",value:argv[3]}));}a.save();return "Contact saved.";',
        [str(input, "first"), optStr(input, "last") ?? "", optStr(input, "phone") ?? "", optStr(input, "email") ?? ""],
      ),
  },
  {
    name: "os_mail_draft",
    description: "Create an email draft in Mail.app (never sends it).",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
      required: ["to"],
    },
    run: async (input) =>
      jxa(
        'var a=Application("Mail");var m=a.OutgoingMessage({subject:argv[1]||"",content:argv[2]||""});' +
          'm.toRecipients.push(a.Recipient({address:argv[0]}));a.outgoingMessages.push(m);return "Mail draft created.";',
        [str(input, "to"), optStr(input, "subject") ?? "", optStr(input, "body") ?? ""],
      ),
  },
  {
    name: "os_send_imessage",
    description: "Send an iMessage to a phone number or Apple ID.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: { to: { type: "string" }, text: { type: "string" } },
      required: ["to", "text"],
    },
    run: async (input) =>
      osa(['tell application "Messages" to send (item 2 of argv) to buddy (item 1 of argv)'], [
        str(input, "to"),
        str(input, "text"),
      ]),
  },
  {
    name: "os_music",
    description: "Control Music.app: play, pause, next, previous.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["play", "pause", "next", "previous"] } },
      required: ["action"],
    },
    run: async (input) => {
      const action = str(input, "action");
      return jxa(
        'var a=Application("Music");var c=argv[0];' +
          'if(c==="play"){a.play();}else if(c==="pause"){a.pause();}' +
          'else if(c==="next"){a.nextTrack();}else if(c==="previous"){a.previousTrack();}' +
          'else{return "unknown action";}return "Music: "+c+".";',
        [action],
      );
    },
  },
  {
    name: "os_clipboard_get",
    description: "Read the current clipboard text.",
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    run: async () => execOrThrow(["pbpaste"], "pbpaste"),
  },
  {
    name: "os_clipboard_set",
    description: "Replace the clipboard with the given text.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    run: async (input) => {
      const res = await execStdin(["pbcopy"], str(input, "text"));
      if (res.code !== 0) throw new Error(`pbcopy failed: ${res.stderr}`);
      return "Clipboard updated.";
    },
  },
  {
    name: "os_notify",
    description: "Show a desktop notification.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, text: { type: "string" } },
      required: ["title", "text"],
    },
    run: async (input) =>
      osa(["display notification (item 2 of argv) with title (item 1 of argv)"], [
        str(input, "title"),
        str(input, "text"),
      ]),
  },
  {
    name: "os_reveal",
    description: "Reveal a file or folder in Finder.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    run: async (input) => execOrThrow(["open", "-R", str(input, "path")], "open"),
  },
  {
    name: "os_run_shortcut",
    description: "Run a named Apple Shortcut.",
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: async (input) => execOrThrow(["shortcuts", "run", str(input, "name")], "shortcuts"),
  },
  {
    name: "os_toggle_dark_mode",
    description: "Toggle macOS dark mode.",
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    run: async () =>
      osaDirect('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'),
  },
  {
    name: "os_system_status",
    description: "Report battery and disk status.",
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const [batt, disk] = await Promise.all([exec(["pmset", "-g", "batt"]), exec(["df", "-h", "/"])]);
      return [batt.stdout, disk.stdout].filter((line) => line.length > 0).join("\n");
    },
  },
];
