import type { AgentName } from "../src/functions/agents/types";

export type ExpectedStep = {
  agent: AgentName;
  prompt?: string;
  family: string;
  tools: string[];
  final?: string;
};

export type ExpectedTurn =
  | { prompt: string; expect: { kind: "plan"; steps: ExpectedStep[] } }
  | { prompt: string; expect: { kind: "clarify"; questionIncludes: string } }
  | { prompt: string; expect: { kind: "unsupported"; reasonIncludes: string; suggestionIncludes: string } }
  | { prompt: string; expect: { kind: "done"; messageIncludes?: string } };

export type FlowCase = {
  id: string;
  turns: ExpectedTurn[];
};

export const FLOW_CASES: FlowCase[] = [
  {
    id: "single:list-todos",
    turns: [
      {
        prompt: "list my last 2 todos",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "todos", tools: ["bee_list_todos"] }],
        },
      },
    ],
  },
  {
    id: "single:show-last-conversations",
    turns: [
      {
        prompt: "show me my last 2 conversations",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "conversations", tools: ["bee_list_conversations"] }],
        },
      },
    ],
  },
  {
    id: "single:what-are-last-todos",
    turns: [
      {
        prompt: "what are my last 6 todos?",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "todos", tools: ["bee_list_todos"] }],
        },
      },
    ],
  },
  {
    id: "single:what-are-oldest-todos",
    turns: [
      {
        prompt: "what are my 6 oldest todos",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "todos", tools: ["bee_list_todos"] }],
        },
      },
    ],
  },
  {
    id: "single:conversation-with-bob",
    turns: [
      {
        prompt: "show me my conversation with Bob",
        expect: {
          kind: "plan",
          steps: [
            {
              agent: "bee_read",
              family: "conversations",
              tools: ["bee_search", "bee_get_conversation"],
            },
          ],
        },
      },
    ],
  },
  {
    id: "single:discuss-coffee",
    turns: [
      {
        prompt: "what did I discuss about coffee last week",
        expect: {
          kind: "plan",
          steps: [
            {
              agent: "bee_read",
              family: "conversations",
              tools: ["bee_search", "bee_get_conversation"],
            },
          ],
        },
      },
    ],
  },
  {
    id: "single:search-facts",
    turns: [
      {
        prompt: "search my facts for coffee",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_read", family: "facts", tools: ["bee_search_facts"] }],
        },
      },
    ],
  },
  {
    id: "single:list-facts",
    turns: [
      {
        prompt: "list my saved facts",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "facts", tools: ["bee_list_facts"] }],
        },
      },
    ],
  },
  {
    id: "single:insights",
    turns: [
      {
        prompt: "show me my insights",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "insights", tools: ["bee_get_insights"] }],
        },
      },
    ],
  },
  {
    id: "single:voice-notes",
    turns: [
      {
        prompt: "list my voice notes",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "journals", tools: ["bee_list_voice_notes"] }],
        },
      },
    ],
  },
  {
    id: "single:location",
    turns: [
      {
        prompt: "where am I right now",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_read", family: "locations", tools: ["bee_get_current_location"] }],
        },
      },
    ],
  },
  {
    id: "single:profile",
    turns: [
      {
        prompt: "what's my name in my bee profile",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_read", family: "status", tools: ["bee_me"] }],
        },
      },
    ],
  },
  {
    id: "single:add-todo",
    turns: [
      {
        prompt: "add a todo to buy milk",
        expect: { kind: "clarify", questionIncludes: "Bee todo" },
      },
    ],
  },
  {
    id: "single:delete-oldest",
    turns: [
      {
        prompt: "delete my oldest todo",
        expect: {
          kind: "plan",
          steps: [
            { agent: "bee_list", family: "todos", tools: ["bee_list_todos"] },
            { agent: "bee_write", prompt: "Delete the todo with the resolved id", family: "todos", tools: ["bee_delete_todo"] },
          ],
        },
      },
    ],
  },
  {
    id: "single:note-from-todos",
    turns: [
      {
        prompt: "create a note from my last 2 todos",
        expect: {
          kind: "plan",
          steps: [
            { agent: "bee_list", family: "todos", tools: ["bee_list_todos"] },
            { agent: "os_action", prompt: "Create a note from these todos", family: "notes", tools: ["os_create_note"] },
          ],
        },
      },
    ],
  },
  {
    id: "single:reminder",
    turns: [
      {
        prompt: "remind me to call mum tomorrow at 9",
        expect: {
          kind: "plan",
          steps: [{ agent: "os_action", family: "reminders", tools: ["os_add_reminder"] }],
        },
      },
    ],
  },
  {
    id: "single:open-browser",
    turns: [
      {
        prompt: "open safari",
        expect: {
          kind: "plan",
          steps: [{ agent: "os_action", family: "browser", tools: ["os_open_app"] }],
        },
      },
    ],
  },
  {
    id: "single:music",
    turns: [
      {
        prompt: "pause the music",
        expect: {
          kind: "plan",
          steps: [{ agent: "os_action", family: "music", tools: ["os_music"] }],
        },
      },
    ],
  },
  {
    id: "single:clipboard",
    turns: [
      {
        prompt: "what's on the clipboard",
        expect: {
          kind: "plan",
          steps: [{ agent: "os_action", family: "clipboard", tools: ["os_clipboard_get"] }],
        },
      },
    ],
  },
  {
    id: "single:battery",
    turns: [
      {
        prompt: "how's my battery",
        expect: {
          kind: "plan",
          steps: [{ agent: "os_action", family: "system", tools: ["os_system_status"] }],
        },
      },
    ],
  },
  {
    id: "single:email-missing-address",
    turns: [
      {
        prompt: "draft an email to bob about lunch",
        expect: { kind: "clarify", questionIncludes: "email address" },
      },
    ],
  },
  {
    id: "single:text-missing-number",
    turns: [
      {
        prompt: "text jane that I'm running late",
        expect: { kind: "clarify", questionIncludes: "phone number" },
      },
    ],
  },
  {
    id: "single:calendar-missing-title",
    turns: [
      {
        prompt: "create a calendar event tomorrow at 3pm",
        expect: { kind: "clarify", questionIncludes: "event" },
      },
    ],
  },
  {
    id: "single:web-search",
    turns: [
      {
        prompt: "search the web for the budget",
        expect: {
          kind: "unsupported",
          reasonIncludes: "can't search the web",
          suggestionIncludes: "search my Bee conversations",
        },
      },
    ],
  },
  {
    id: "single:read-notes",
    turns: [
      {
        prompt: "read my notes",
        expect: {
          kind: "unsupported",
          reasonIncludes: "can't read Notes",
          suggestionIncludes: "Paste the note text",
        },
      },
    ],
  },
  {
    id: "single:list-reminders",
    turns: [
      {
        prompt: "list my reminders",
        expect: {
          kind: "unsupported",
          reasonIncludes: "can't read Reminders",
          suggestionIncludes: "remind me",
        },
      },
    ],
  },
  {
    id: "single:math",
    turns: [
      {
        prompt: "what is 2 plus 2",
        expect: { kind: "done" },
      },
    ],
  },
  {
    id: "multi:note-from-second-todo",
    turns: [
      {
        prompt: "list my last 2 todos",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "todos", tools: ["bee_list_todos"] }],
        },
      },
      {
        prompt: "create a note from the second one",
        expect: {
          kind: "plan",
          steps: [
            {
              agent: "os_action",
              prompt: "Create a note from the second todo",
              family: "notes",
              tools: ["os_create_note"],
            },
          ],
        },
      },
    ],
  },
  {
    id: "multi:complete-second-todo",
    turns: [
      {
        prompt: "list my last 2 todos",
        expect: {
          kind: "plan",
          steps: [{ agent: "bee_list", family: "todos", tools: ["bee_list_todos"] }],
        },
      },
      {
        prompt: "mark the second one complete",
        expect: {
          kind: "plan",
          steps: [
            {
              agent: "bee_write",
              prompt: "Complete the second todo",
              family: "todos",
              tools: ["bee_complete_todo"],
            },
          ],
        },
      },
    ],
  },
  {
    id: "multi:clarify-add-todo",
    turns: [
      {
        prompt: "add a todo to buy milk",
        expect: { kind: "clarify", questionIncludes: "Bee" },
      },
      {
        prompt: "Bee",
        expect: {
          kind: "plan",
          steps: [
            {
              agent: "bee_write",
              prompt: "Create the Bee todo",
              family: "todos",
              tools: ["bee_create_todo"],
            },
          ],
        },
      },
    ],
  },
];
