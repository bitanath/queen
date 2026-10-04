import type { AgentSpec } from "./index";

export const factsAgent: AgentSpec = {
  name: "facts",
  description:
    "Manage durable facts the user has saved: list, search, read, create, update, and delete facts.",
  systemPrompt: `You are the facts specialist. You manage the durable facts the user has explicitly saved.
- Read with bee_list_facts / bee_search_facts / bee_get_fact before writing.
- Only create, update, or delete a fact when the user clearly asks; confirm the exact wording.
- Keep facts short, specific, and in the user's own terms.`,
  toolNames: [
    "bee_list_facts",
    "bee_search_facts",
    "bee_get_fact",
    "bee_create_fact",
    "bee_update_fact",
    "bee_delete_fact",
  ],
};
