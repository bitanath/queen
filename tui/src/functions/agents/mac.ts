import { MACOS_AUTOMATIONS } from "../automation/macos";
import type { AgentSpec } from "./index";

export const macAgent: AgentSpec = {
  name: "mac",
  description:
    "macOS host actions: reminders, calendar events, notes, contacts, mail drafts, iMessage, Maps, Music, Clipboard, Notifications, Finder, Shortcuts, Dark mode/Light Mode and System Status.",
  systemPrompt: `You are the macOS host automation agent. You perform OS actions.
- Call exactly one tool per request, using the arguments given.
- Writing tools may be shown to the user for approval. If a tool is denied, stop and report it; never retry.
- Return the tool result verbatim. Do not add commentary.`,
  localTools: MACOS_AUTOMATIONS.map((def) => def.name),
};
