import type { AgentSpec } from "./index";

export const locationsAgent: AgentSpec = {
  name: "locations",
  description:
    "Where the user has been: location clusters, recent visits, and current location.",
  systemPrompt: `You are the locations specialist. You answer where the user has been and where they are now.
- Use bee_get_location_clusters for frequent places, bee_get_recent_visits for a timeline, bee_get_current_location for latest.
- Location is sensitive: answer only what was asked and keep it concise.`,
  toolNames: [
    "bee_get_location_clusters",
    "bee_get_recent_visits",
    "bee_get_current_location",
  ],
};
