import type { AgentSpec } from "./index";

export const journalsAgent: AgentSpec = {
  name: "journals",
  description:
    "Voice notes and journal-style entries, and where the user has been: list, search, read, location clusters, recent visits, current location.",
  systemPrompt: `You are the journals specialist. You handle the user's voice notes and journal-style entries, and their location history.
- Use bee_list_voice_notes to browse, bee_search_voice_notes to search, bee_get_voice_note to read one in full.
- Use bee_get_location_clusters for frequent places, bee_get_recent_visits for a timeline, bee_get_current_location for the latest.
- Quote the user's own words where it matters; location is sensitive, so answer only what was asked and keep it concise.`,
  toolNames: [
    "bee_list_voice_notes",
    "bee_search_voice_notes",
    "bee_get_voice_note",
    "bee_get_location_clusters",
    "bee_get_recent_visits",
    "bee_get_current_location",
  ],
};
