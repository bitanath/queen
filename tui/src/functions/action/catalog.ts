import type { DocumentKind } from "../../documents";

export type ActionScope = "document" | "collection";

export type QueenAction = {
  id: string;
  label: string;
  subtitle: string;
  /** Document kinds this action applies to. Empty = collection-wide. */
  docKinds: DocumentKind[];
  scope: ActionScope;
  resource: string;
  subcommand?: string;
};

type Definition = {
  resource: string;
  subcommand?: string;
  subtitle: string;
  kind?: DocumentKind;
  scope?: ActionScope;
};

const DEFS: Definition[] = [
  //TODO CRUD actions on conversations from actual pinned Bee CLI
  { resource: "conversations", subcommand: "list", subtitle: "list recent conversations", scope: "collection" },
  { resource: "conversations", subcommand: "get", subtitle: "reload this conversation", kind: "conversation" },
  { resource: "conversations", subcommand: "transcript", subtitle: "show the transcript only", kind: "conversation" },
  { resource: "conversations", subcommand: "related", subtitle: "find related conversations", kind: "conversation" },
  { resource: "activity", subtitle: "recent Bee activity", scope: "collection" },

  //NOTE similarly, let's also do daily summaries
  { resource: "daily", subcommand: "list", subtitle: "list daily summaries", scope: "collection" },
  { resource: "daily", subcommand: "get", subtitle: "reload this daily summary", kind: "daily" },
  { resource: "daily", subcommand: "find", subtitle: "find a summary by date", scope: "collection" },

  //NOTE just the facts
  { resource: "facts", subcommand: "list", subtitle: "list saved facts", scope: "collection" },
  { resource: "facts", subcommand: "search", subtitle: "search saved facts", scope: "collection" },
  { resource: "facts", subcommand: "get", subtitle: "reload this fact", kind: "fact" },
  { resource: "facts", subcommand: "create", subtitle: "create a new fact", scope: "collection" },
  { resource: "facts", subcommand: "update", subtitle: "edit this fact", kind: "fact" },
  { resource: "facts", subcommand: "confirm", subtitle: "confirm this fact", kind: "fact" },
  { resource: "facts", subcommand: "delete", subtitle: "delete this fact", kind: "fact" },

  //MARK insightful insights
  { resource: "insights", subcommand: "list", subtitle: "list Bee insights", scope: "collection" },
  { resource: "insights", subcommand: "get", subtitle: "reload this insight", kind: "insight" },

  //MARK get some journals / voice notes
  { resource: "journals", subcommand: "list", subtitle: "list journals and voice notes", scope: "collection" },
  { resource: "journals", subcommand: "search", subtitle: "search journals and voice notes", scope: "collection" },
  { resource: "journals", subcommand: "get", subtitle: "reload this journal", kind: "journal" },

  //TODO todos
  { resource: "todos", subcommand: "list", subtitle: "list todos", scope: "collection" },
  { resource: "todos", subcommand: "get", subtitle: "reload this todo", kind: "todo" },
  { resource: "todos", subcommand: "create", subtitle: "create a todo", scope: "collection" },
  { resource: "todos", subcommand: "update", subtitle: "edit this todo", kind: "todo" },
  { resource: "todos", subcommand: "complete", subtitle: "mark this todo complete", kind: "todo" },
  { resource: "todos", subcommand: "delete", subtitle: "delete this todo", kind: "todo" },
  { resource: "todos", subcommand: "suggestions", subtitle: "review suggested todos", scope: "collection" },
  { resource: "todos", subcommand: "accept-suggestion", subtitle: "accept a suggested todo", kind: "todo" },
  { resource: "todos", subcommand: "dismiss-suggestion", subtitle: "dismiss a suggested todo", kind: "todo" },

  //MARK other resources (collection-wide)
  { resource: "external-access", subcommand: "list", subtitle: "list external data access", scope: "collection" },
  { resource: "locations", subcommand: "clusters", subtitle: "show location clusters", scope: "collection" },
  { resource: "locations", subcommand: "recent", subtitle: "show recent visits", scope: "collection" },
  { resource: "locations", subcommand: "current", subtitle: "show current location", scope: "collection" },
  { resource: "photos", subcommand: "list", subtitle: "list Bee photos", scope: "collection" },
  { resource: "photos", subcommand: "get", subtitle: "download a Bee photo", scope: "collection" },
  { resource: "search", subtitle: "search Bee data", scope: "collection" },

  //TODO external commands that we simply just port from the CLI itself
  { resource: "status", subtitle: "show auth and connection status", scope: "collection" },
  { resource: "today", subtitle: "today's brief (calendar + email)", scope: "collection" },
  { resource: "now", subtitle: "recent conversations with utterances", scope: "collection" },
  { resource: "changed", subtitle: "recently changed entities", scope: "collection" },
  { resource: "me", subtitle: "your Bee profile", scope: "collection" },
  { resource: "sync", subtitle: "export Bee data to markdown", scope: "collection" },
  { resource: "login", subtitle: "connect your Bee account", scope: "collection" },
  { resource: "logout", subtitle: "clear Bee credentials", scope: "collection" },
  { resource: "mcp", subtitle: "run or connect Bee MCP", scope: "collection" },
  { resource: "stream", subtitle: "stream real-time Bee events", scope: "collection" },
  { resource: "proxy", subtitle: "start a local Bee API proxy", scope: "collection" },
  { resource: "ping", subtitle: "connectivity check", scope: "collection" },
  { resource: "version", subtitle: "print both the BEE CLI and QUEEN version", scope: "collection" }
];

export const ACTION_CATALOG: QueenAction[] = DEFS.map((def) => {
  const label = def.subcommand ? `${def.resource} ${def.subcommand}` : def.resource;
  return {
    id: label,
    label,
    subtitle: def.subtitle,
    docKinds: def.kind ? [def.kind] : [],
    scope: def.scope ?? "document",
    resource: def.resource,
    ...(def.subcommand ? { subcommand: def.subcommand } : {}),
  };
});

export function actionsForDocument(kind: DocumentKind): QueenAction[] {
  return ACTION_CATALOG.filter(
    (action) => action.docKinds.includes(kind) && action.scope === "document",
  );
}
