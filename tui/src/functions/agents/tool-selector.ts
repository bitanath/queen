import { automationToolNames } from "../automation";
import type { AgentName } from "./types";

export const BEE_READ_TOOLS = [
  "bee_status",
  "bee_search",
  "bee_list_facts",
  "bee_search_facts",
  "bee_get_fact",
  "bee_get_recent_activity",
  "bee_get_today",
  "bee_list_conversations",
  "bee_get_conversation",
  "bee_get_conversation_transcript",
  "bee_get_related_conversations",
  "bee_get_daily_summary",
  "bee_list_daily_summaries",
  "bee_list_external_access",
  "bee_list_voice_notes",
  "bee_search_voice_notes",
  "bee_get_voice_note",
  "bee_list_todos",
  "bee_get_todo_suggestions",
  "bee_get_insights",
  "bee_get_insight",
  "bee_get_location_clusters",
  "bee_get_recent_visits",
  "bee_get_current_location",
  "bee_get_photos",
  "bee_get_photo",
] as const;

export const BEE_WRITE_TOOLS = [
  "bee_create_fact",
  "bee_update_fact",
  "bee_delete_fact",
  "bee_create_todo",
  "bee_update_todo",
  "bee_complete_todo",
  "bee_delete_todo",
  "bee_accept_todo_suggestion",
  "bee_dismiss_todo_suggestion",
] as const;

const LIST_TOOLS = [
  "bee_list_conversations",
  "bee_list_facts",
  "bee_list_daily_summaries",
  "bee_list_external_access",
  "bee_list_voice_notes",
  "bee_list_todos",
  "bee_get_todo_suggestions",
  "bee_get_insights",
  "bee_get_location_clusters",
  "bee_get_recent_visits",
  "bee_get_current_location",
  "bee_get_photos",
  "bee_get_recent_activity",
  "bee_get_today",
  "bee_status",
] as const;

const CONVERSATION_READ = [
  "bee_search",
  "bee_list_conversations",
  "bee_get_conversation",
  "bee_get_conversation_transcript",
  "bee_get_related_conversations",
  "bee_get_today",
  "bee_get_recent_activity",
];

const FACT_READ = ["bee_search", "bee_search_facts", "bee_list_facts", "bee_get_fact"];
const TODO_READ = ["bee_list_todos", "bee_get_todo_suggestions"];
const DAILY_READ = ["bee_list_daily_summaries", "bee_get_daily_summary", "bee_get_today", "bee_get_recent_activity"];
const INSIGHT_READ = ["bee_get_insights", "bee_get_insight"];
const JOURNAL_READ = ["bee_list_voice_notes", "bee_search_voice_notes", "bee_get_voice_note"];
const LOCATION_READ = ["bee_get_location_clusters", "bee_get_recent_visits", "bee_get_current_location"];
const PHOTO_READ = ["bee_get_photos", "bee_get_photo"];
const STATUS_READ = ["bee_status", "bee_list_external_access", "bee_me"];

const FACT_WRITE = ["bee_create_fact", "bee_update_fact", "bee_delete_fact"];
const TODO_WRITE = ["bee_create_todo", "bee_update_todo", "bee_complete_todo", "bee_delete_todo"];
const SUGGESTION_WRITE = ["bee_accept_todo_suggestion", "bee_dismiss_todo_suggestion"];

const CONVERSATION_LIST = ["bee_list_conversations"];
const FACT_LIST = ["bee_list_facts"];
const TODO_LIST = ["bee_list_todos"];
const SUGGESTION_LIST = ["bee_get_todo_suggestions"];
const DAILY_LIST = ["bee_list_daily_summaries"];
const INSIGHT_LIST = ["bee_get_insights"];
const JOURNAL_LIST = ["bee_list_voice_notes"];
const LOCATION_LIST = ["bee_get_location_clusters", "bee_get_recent_visits", "bee_get_current_location"];
const PHOTO_LIST = ["bee_get_photos"];
const ACTIVITY_LIST = ["bee_get_recent_activity", "bee_get_today"];

const OS_NOTE = ["os_create_note"];
const OS_REMINDER = ["os_add_reminder"];
const OS_CALENDAR = ["os_add_calendar_event"];
const OS_MAIL = ["os_mail_draft"];
const OS_MESSAGE = ["os_send_imessage"];
const OS_MUSIC = ["os_music"];
const OS_CLIPBOARD = ["os_clipboard_get", "os_clipboard_set"];
const OS_BROWSER = ["os_open_url", "os_open_app"];
const OS_MAPS = ["os_show_location", "os_directions"];
const OS_FINDER = ["os_reveal"];
const OS_SHORTCUT = ["os_run_shortcut"];
const OS_SYSTEM = ["os_system_status", "os_toggle_dark_mode"];
const OS_NOTIFY = ["os_notify"];
const OS_CONTACT = ["os_add_contact"];

type Family = { label: string; test: RegExp; tools: readonly string[] };

const READ_FAMILIES: Family[] = [
  { label: "conversations", test: /conversation|transcript|talk|said|say|spoke|discuss|mention|hear|chat/, tools: CONVERSATION_READ },
  { label: "facts", test: /\bfact|facts|memory|memories|remember/, tools: FACT_READ },
  { label: "todos", test: /\btodo|todos|task|tasks/, tools: TODO_READ },
  { label: "daily", test: /\bdaily|summary|summaries|brief|today|yesterday|day\b/, tools: DAILY_READ },
  { label: "insights", test: /\binsight|insights/, tools: INSIGHT_READ },
  { label: "journals", test: /journal|voice note|voice notes/, tools: JOURNAL_READ },
  { label: "locations", test: /\blocation|visit|visits|where|place|been|address/, tools: LOCATION_READ },
  { label: "photos", test: /\bphoto|photos|picture|pictures|image|images/, tools: PHOTO_READ },
  { label: "activity", test: /\brecent|activity|been up to|just now|changed\b/, tools: ["bee_get_recent_activity", "bee_get_today"] },
  { label: "status", test: /\bstatus|logged in|profile|external access|services.*accessed|reachable|ping/, tools: STATUS_READ },
];

const LIST_FAMILIES: Family[] = [
  { label: "conversations", test: /conversation|transcript|talk|said|discuss|mention|chat/, tools: CONVERSATION_LIST },
  { label: "facts", test: /\bfact|facts|memory|memories/, tools: FACT_LIST },
  { label: "todos", test: /\btodo|todos|task|tasks/, tools: TODO_LIST },
  { label: "suggestions", test: /suggested todo|todo suggestion|suggestions/, tools: SUGGESTION_LIST },
  { label: "daily", test: /\bdaily|summary|summaries|brief|today|yesterday|day\b/, tools: DAILY_LIST },
  { label: "insights", test: /\binsight|insights/, tools: INSIGHT_LIST },
  { label: "journals", test: /journal|voice note|voice notes/, tools: JOURNAL_LIST },
  { label: "locations", test: /\blocation|visit|visits|where|place|been/, tools: LOCATION_LIST },
  { label: "photos", test: /\bphoto|photos|picture|pictures|image|images/, tools: PHOTO_LIST },
  { label: "activity", test: /recent|activity|been up to|just now|changed/, tools: ACTIVITY_LIST },
  { label: "external", test: /external access|services.*accessed/, tools: ["bee_list_external_access"] },
  { label: "status", test: /\bstatus|logged in|profile|reachable|ping/, tools: ["bee_status"] },
];

const WRITE_FAMILIES: Family[] = [
  { label: "facts", test: /\bfact|facts|memory|memories/, tools: FACT_WRITE },
  { label: "todos", test: /\btodo|todos|task|tasks/, tools: TODO_WRITE },
  { label: "suggestions", test: /suggested todo|todo suggestion|suggestions/, tools: SUGGESTION_WRITE },
];

const OS_FAMILIES: Family[] = [
  { label: "notes", test: /\bnote|notes/, tools: OS_NOTE },
  { label: "reminders", test: /\bremind|reminder|reminders/, tools: OS_REMINDER },
  { label: "calendar", test: /\bcalendar|meeting|appointment|event/, tools: OS_CALENDAR },
  { label: "mail", test: /\bemail|mail|draft/, tools: OS_MAIL },
  { label: "messages", test: /\bimessage|text message|text\b|message\b/, tools: OS_MESSAGE },
  { label: "music", test: /\bmusic|song|play|pause|skip|track/, tools: OS_MUSIC },
  { label: "clipboard", test: /\bclipboard|copy|paste/, tools: OS_CLIPBOARD },
  { label: "browser", test: /\bbrowser|url|website|open\b|launch|app\b/, tools: OS_BROWSER },
  { label: "maps", test: /\bmap|maps|address|directions|navigate|airport/, tools: OS_MAPS },
  { label: "finder", test: /\bfinder|reveal|folder|downloads/, tools: OS_FINDER },
  { label: "shortcuts", test: /\bshortcut|shortcuts/, tools: OS_SHORTCUT },
  { label: "system", test: /\bbattery|disk|system status|dark mode|light mode/, tools: OS_SYSTEM },
  { label: "notifications", test: /\bnotify|notification|notifications/, tools: OS_NOTIFY },
  { label: "contacts", test: /\bcontact|contacts/, tools: OS_CONTACT },
];

function familyResult(
  families: Family[],
  prompt: string,
  fallback: readonly string[],
): { family: string; tools: string[] } {
  const lower = prompt.toLowerCase();
  const matched = families.filter((family) => family.test.test(lower));
  if (matched.length === 0) return { family: "all", tools: [...fallback] };
  const tools = [...new Set(matched.flatMap((family) => family.tools))];
  return { family: matched.map((family) => family.label).join("+"), tools };
}

export function selectTools(
  agent: AgentName,
  prompt: string,
  context?: { kinds?: string[] },
): { family: string; tools: string[] } {
  const enriched = [prompt, ...(context?.kinds ?? [])].join(" ");
  switch (agent) {
    case "bee_read":
      return familyResult(READ_FAMILIES, enriched, [...BEE_READ_TOOLS, "bee_me"]);
    case "bee_list":
      return familyResult(LIST_FAMILIES, enriched, LIST_TOOLS);
    case "bee_write":
      return familyResult(WRITE_FAMILIES, enriched, BEE_WRITE_TOOLS);
    case "os_action": {
      const available = new Set(automationToolNames());
      const result = familyResult(OS_FAMILIES, enriched, automationToolNames());
      return {
        family: result.family,
        tools: result.tools.filter((name) => available.has(name)),
      };
    }
    default:
      return { family: "all", tools: [] };
  }
}
