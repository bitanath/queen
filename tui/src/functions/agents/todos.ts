import type { AgentSpec } from "./index";

export const todosAgent: AgentSpec = {
  name: "todos",
  description:
    "Tasks and reminders: list, create, update, complete, delete, and review Bee's todo suggestions.",
  systemPrompt: `You are the todos specialist. You manage the user's tasks and reminders.
- Read with bee_list_todos first. Use the create/update/complete/delete tools only when asked.
- Review pending suggestions with bee_get_todo_suggestions and accept or dismiss on request.
- Confirm dates and reminders explicitly before writing.`,
  toolNames: [
    "bee_list_todos",
    "bee_create_todo",
    "bee_update_todo",
    "bee_complete_todo",
    "bee_delete_todo",
    "bee_get_todo_suggestions",
    "bee_accept_todo_suggestion",
    "bee_dismiss_todo_suggestion",
  ],
};
