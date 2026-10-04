import type { AgentSpec } from "./index";

export const journalsAgent: AgentSpec = {
  name: "journals",
  description: "Voice notes and journal-style entries: list, search, and read.",
  systemPrompt: `You are the journals specialist. You handle the user's voice notes and journal-style entries.
- Use bee_list_voice_notes to browse, bee_search_voice_notes to search, bee_get_voice_note to read one in full.
- Quote the user's own words where it matters and keep summaries faithful.`,
  toolNames: ["bee_list_voice_notes", "bee_search_voice_notes", "bee_get_voice_note"],
};
