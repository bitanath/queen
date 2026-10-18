import { exec, execOrThrow, execStdin, str } from "./exec";
import type { AutomationDef } from "./types";

async function clipboardGet(): Promise<string> {
  for (const cmd of [
    ["wl-paste", "--no-newline"],
    ["xclip", "-selection", "clipboard", "-o"],
    ["xsel", "--clipboard", "--output"],
  ]) {
    const res = await exec(cmd);
    if (res.code === 0) return res.stdout.length > 0 ? res.stdout : "ok";
  }
  throw new Error("No clipboard tool found (install wl-clipboard, xclip or xsel).");
} //TODO only a subset of mac automation exists for Linux

async function clipboardSet(text: string): Promise<string> {
  for (const cmd of [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]) {
    const res = await execStdin(cmd, text);
    if (res.code === 0) return "Clipboard updated.";
  }
  throw new Error("No clipboard tool found (install wl-clipboard, xclip or xsel).");
}

export const LINUX_AUTOMATIONS: AutomationDef[] = [
  {
    name: "os_open_url",
    description: "Open a URL in the user's default browser.",
    risk: "low",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async (input) => execOrThrow(["xdg-open", str(input, "url")], "xdg-open"),
  },
  {
    name: "os_show_location",
    description: "Show a place on OpenStreetMap.",
    risk: "low",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (input) =>
      execOrThrow(
        ["xdg-open", `https://www.openstreetmap.org/search?query=${encodeURIComponent(str(input, "query"))}`],
        "xdg-open",
      ),
  },
  {
    name: "os_clipboard_get",
    description: "Read the current clipboard text.",
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    run: clipboardGet,
  },
  {
    name: "os_clipboard_set",
    description: "Replace the clipboard with the given text.",
    risk: "medium",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: (input) => clipboardSet(str(input, "text")),
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
    run: async (input) => execOrThrow(["notify-send", str(input, "title"), str(input, "text")], "notify-send"),
  },
  {
    name: "os_reveal",
    description: "Open a file or folder in the file manager.",
    risk: "low",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: async (input) => execOrThrow(["xdg-open", str(input, "path")], "xdg-open"),
  },
  {
    name: "os_system_status",
    description: "Report memory and disk status.",
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const [mem, disk] = await Promise.all([exec(["free", "-h"]), exec(["df", "-h", "/"])]);
      return [mem.stdout, disk.stdout].filter((line) => line.length > 0).join("\n");
    },
  },
];
