import { automationToolNames } from "../automation";
import type { AgentSpec } from "./index";

export const macAgent: AgentSpec = {
  name: "mac",
  description:
    "Host actions: reminders, calendar events, notes, contacts, mail drafts, iMessage, Maps, Music, Clipboard, Notifications, Finder, Shortcuts, Dark mode/Light Mode and System Status.",
  systemPrompt: `You are the host automation agent. You perform OS actions.
- Call exactly one tool per request, using the arguments given.
- Writing tools may be shown to the user for approval. If a tool is denied, stop and report it; never retry.
- Return the tool result verbatim. Do not add commentary.`,
  localTools: automationToolNames() //FIXME: Linux and MacOS we support both haha
};
