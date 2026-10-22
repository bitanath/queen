import { callBeeTextTool } from "@/commands/mcpToolOutput";

import type { CommandResult } from "../../utils/bee-com-bridge";
import type { DocumentKind, QueenDocument } from "../../documents";
import {
  beeContext,
  buildTable,
  getChanged,
  getMe,
  getNow,
  getStatus,
  getTodayBrief,
  logout,
  renderStatusMd,
} from "../../utils/bee-com-bridge";
import type { AnswerView } from "../../utils/answer-view";
import type { DocFilter } from "../ui-bridge";
import type { QueenAction } from "./catalog";

export type ActionOutcome = {
  title: string;
  view?: AnswerView;
  markdown?: string;
  refresh?: DocFilter | true | null;
  toast?: string;
};

type ListSpec = { tool: string; title: string; kinds: DocumentKind[]; args?: () => Record<string, unknown> };

const LISTS: Record<string, ListSpec> = {
  conversations: { tool: "bee_list_conversations", title: "Conversations", kinds: ["conversation"] },
  daily: { tool: "bee_list_daily_summaries", title: "Daily Summaries", kinds: ["daily"] },
  facts: { tool: "bee_list_facts", title: "Facts", kinds: ["fact"], args: () => ({ includeUnconfirmed: true }) },
  insights: { tool: "bee_get_insights", title: "Insights", kinds: ["insight"] },
  journals: { tool: "bee_list_voice_notes", title: "Journals", kinds: ["journal"] },
  todos: { tool: "bee_list_todos", title: "Todos", kinds: ["todo"] },
  "external-access": { tool: "bee_list_external_access", title: "External Access", kinds: [] },
  photos: { tool: "bee_get_photos", title: "Photos", kinds: [] },
  activity: { tool: "bee_get_recent_activity", title: "Recent Activity", kinds: [] },
};

const LOCATION_TOOLS: Record<string, { tool: string; title: string }> = {
  clusters: { tool: "bee_get_location_clusters", title: "Location Clusters" },
  recent: { tool: "bee_get_recent_visits", title: "Recent Visits" },
  current: { tool: "bee_get_current_location", title: "Current Location" },
};

function viewFromTable(title: string, table: NonNullable<CommandResult["view"]>["table"]): ActionOutcome {
  return table ? { title, view: { title, table } } : { title, markdown: `_No ${title.toLowerCase()}._` };
}

function tableView(title: string, data: unknown): ActionOutcome {
  return viewFromTable(title, buildTable(data));
}

function fromResult(title: string, result: CommandResult): ActionOutcome {
  return result.view?.table ? viewFromTable(title, result.view.table) : { title, markdown: result.text };
}

function idArg(doc: QueenDocument): number | string {
  const id = Number(doc.id);
  return Number.isFinite(id) ? id : doc.id;
}

async function runList(spec: ListSpec): Promise<ActionOutcome> {
  const ctx = await beeContext("prod");
  const data = await callBeeTextTool(ctx, spec.tool, { ...(spec.args ? spec.args() : {}), limit: 25 });
  return { ...tableView(spec.title, data), refresh: spec.kinds.length > 0 ? { kinds: spec.kinds } : null };
}


export function actionTool(action: QueenAction): string | null {
  const list = LISTS[action.resource];
  if (list && (action.subcommand === undefined || action.subcommand === "list")) return list.tool;
  if (action.resource === "locations") {
    return (LOCATION_TOOLS[action.subcommand ?? "clusters"] ?? LOCATION_TOOLS.clusters!).tool; //HACK: don't really have location in data
  }
  if (action.resource === "conversations" && action.subcommand === "related") return "bee_get_related_conversations";
  return null;
}

export async function executeAction(action: QueenAction, doc: QueenDocument | undefined): Promise<ActionOutcome> {
  const { resource, subcommand } = action;

  const list = LISTS[resource];
  if (list && (subcommand === undefined || subcommand === "list")) {
    return runList(list);
  }
  if (subcommand === "get" && doc) {
    return { title: doc.title, refresh: true };
  }
  if (resource === "todos" && (subcommand === "complete" || subcommand === "delete") && doc) {
    const ctx = await beeContext("prod");
    const tool = subcommand === "complete" ? "bee_complete_todo" : "bee_delete_todo";
    await callBeeTextTool(ctx, tool, { id: idArg(doc) });
    return {
      title: action.label,
      markdown: subcommand === "complete" ? "Todo completed." : "Todo deleted.",
      refresh: true,
    };
  }
  if (resource === "facts" && (subcommand === "confirm" || subcommand === "delete") && doc) {
    const ctx = await beeContext("prod");
    if (subcommand === "confirm") {
      await callBeeTextTool(ctx, "bee_update_fact", { id: idArg(doc), confirmed: true });
    } else {
      await callBeeTextTool(ctx, "bee_delete_fact", { id: idArg(doc) });
    }
    return {
      title: action.label,
      markdown: subcommand === "confirm" ? "Fact confirmed." : "Fact deleted.",
      refresh: true,
    };
  }
  if (
    resource === "todos" &&
    (subcommand === "accept-suggestion" || subcommand === "dismiss-suggestion") &&
    doc
  ) {
    const ctx = await beeContext("prod");
    const tool = subcommand === "accept-suggestion"
      ? "bee_accept_todo_suggestion"
      : "bee_dismiss_todo_suggestion";
    await callBeeTextTool(ctx, tool, { id: idArg(doc) });
    return {
      title: action.label,
      markdown: subcommand === "accept-suggestion" ? "Suggestion accepted." : "Suggestion dismissed.",
      refresh: true,
    };
  }
  if (subcommand === "transcript" && doc) {
    return { title: "Transcript", markdown: doc.transcript.length > 0 ? doc.transcript : "_No transcript captured._" };
  }
  if (resource === "conversations" && subcommand === "related" && doc) {
    const ctx = await beeContext("prod");
    const data = await callBeeTextTool(ctx, "bee_get_related_conversations", { id: Number(doc.id) || doc.id, limit: 10 });
    return { ...tableView("Related Conversations", data), refresh: null };
  }
  if (resource === "locations") {
    const spec = LOCATION_TOOLS[subcommand ?? "clusters"] ?? { tool: "bee_get_location_clusters", title: "Location Clusters" };
    const ctx = await beeContext("prod");
    const data = await callBeeTextTool(ctx, spec.tool, { limit: 25 });
    return { ...tableView(spec.title, data), refresh: { kinds: ["location"] } };
  }

  switch (resource) {
    case "status":
      return { title: "status", markdown: renderStatusMd(await getStatus()), refresh: null };
    case "me":
      return fromResult("Profile", await getMe());
    case "today":
      return fromResult("today", await getTodayBrief());
    case "now":
      return { title: "now", markdown: await getNow(), refresh: null };
    case "changed":
      return { title: "changed", markdown: await getChanged("prod"), refresh: null };
    case "logout":
      await logout();
      return { title: "logout", toast: "Logged out.", refresh: null };
    case "login":
      return { title: "login", toast: "Starting Bee login…", refresh: null };
    case "ping":
      return { title: "ping", markdown: "pong", refresh: null };
    case "version":
      return { title: "version", markdown: "queen", refresh: null };
    case "sync":
      return { title: "sync", toast: "Use the chat to sync Bee data to disk.", refresh: null };
    default:
      break;
  }

  return {
    title: action.label,
    markdown: `\`${action.label}\` needs an argument — ask Queen in the chat instead.`,
    refresh: null,
  };
}
