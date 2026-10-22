import type { Tool } from "@strands-agents/sdk";

import type { AgentName, NeedsInput, SessionState, Unsupported } from "./types";

type UnsupportedRule = {
  test: RegExp;
  reason: string;
  suggestion: string;
};

const UNSUPPORTED: UnsupportedRule[] = [
  {
    test: /\b(?:search|google|look up)\b.*\b(?:web|internet|online)\b|\bweb search\b/,
    reason: "I can't search the web.",
    suggestion: "Try “search my Bee conversations and facts for the topic”.",
  },
  {
    test: /\b(?:find|look up|get|what(?:'s| is))\b.*\b(?:email|phone|contact)\b/,
    reason: "I can't look up contacts or contact details.",
    suggestion: "Give me the email address or phone number and ask me to use it.",
  },
  {
    test: /\b(?:read|show|list|open|what(?:'s| is) in)\b.*\bnotes?\b/,
    reason: "I can't read Notes.",
    suggestion: "Paste the note text and ask me to save it, or ask me to create a new note.",
  },
  {
    test: /\b(?:list|show|read|what(?:'s| are))\b.*\breminders?\b/,
    reason: "I can't read Reminders.",
    suggestion: "I can create one — try “remind me to call mum tomorrow at 9”.",
  },
  {
    test: /\b(?:list|show|read|what(?:'s| are))\b.*\bcalendar\b|\bwhat(?:'s| is) on my calendar\b/,
    reason: "I can't read the calendar.",
    suggestion: "I can add an event — try “add a meeting to my calendar tomorrow at 3pm”.",
  },
  {
    test: /\b(?:find|search for)\b.*\bfiles?\b|\bwhere is\b.*\bfile\b/,
    reason: "I can't search your files.",
    suggestion: "Give me a path and ask me to reveal it in Finder.",
  },
];

export function detectUnsupported(prompt: string): Unsupported | undefined {
  const lower = prompt.toLowerCase();
  const rule = UNSUPPORTED.find((entry) => {
    if (entry.reason === "I can't read Notes." && /\b(?:voice notes?|bee notes?|journals?)\b/.test(lower)) {
      return false;
    }
    return entry.test.test(lower);
  });
  return rule ? { reason: rule.reason, suggestion: rule.suggestion } : undefined;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;

function hasReference(prompt: string): boolean {
  return /\b(?:this|that|it|them|these|those|first|second|third|oldest|newest|latest|last)\b/i.test(prompt);
}

export function detectMissingInput(
  agent: AgentName,
  prompt: string,
  session: SessionState,
): NeedsInput | undefined {
  const lower = prompt.toLowerCase();

  if (agent === "os_action") {
    if (/\bemail|mail|draft\b/.test(lower) && !EMAIL.test(prompt)) {
      return { question: "What email address should I use?" };
    }
    if (/\bimessage|text\b|message\b/.test(lower) && !EMAIL.test(prompt) && !PHONE.test(prompt)) {
      return { question: "What phone number or Apple ID should I use?" };
    }
    if (/\bnote|notes\b/.test(lower) && hasReference(prompt) && !session.lastResult?.text && !session.activeDoc?.summary) {
      return { question: "What should the note contain?" };
    }
    if (/\bclipboard|copy|paste\b/.test(lower) && hasReference(prompt) && !session.lastResult?.text && !session.activeDoc?.summary) {
      return { question: "What text should I use?" };
    }
    if (/\b(?:this|that) address\b/.test(lower) && !session.activeDoc?.summary && !session.lastResult?.text) {
      return { question: "Which address should I use?" };
    }
    if (/\b(?:calendar event|event)\b/.test(lower) && !/\b(?:about|titled|called|for|with)\b/.test(lower)) {
      return { question: "What should the event be called?" };
    }
    if (/\bremind\b/.test(lower) && !/\bto\b|\babout\b/.test(lower)) {
      return { question: "What should I remind you about?" };
    }
  }

  if (agent === "bee_write" && hasReference(prompt) && !session.lastEntity && !session.lastResult) {
    return { question: "Which item do you mean?" };
  }

  return undefined;
}

export function requiredFields(tool: Tool | undefined): string[] {
  const schema = tool?.toolSpec.inputSchema as { required?: unknown } | undefined;
  return Array.isArray(schema?.required) ? schema.required.map(String) : [];
}

export function missingFields(tool: Tool | undefined, args: Record<string, unknown>): string[] {
  return requiredFields(tool).filter((field) => {
    const value = args[field];
    return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
  });
}

export function inputForMissing(tool: string, fields: string[]): NeedsInput {
  const field = fields[0] ?? "value";
  if (field === "to") {
    if (tool.includes("imessage")) return { question: "What phone number or Apple ID should I use?" };
    return { question: "What email address should I use?" };
  }
  if (field === "title") {
    if (tool.includes("calendar")) return { question: "What should the event be called?" };
    return { question: "What should the note be called?" };
  }
  if (field === "text" || field === "body") return { question: "What text should I use?" };
  if (field === "path") return { question: "Which path should I use?" };
  if (field === "id") return { question: "Which item do you mean?" };
  if (field === "start") return { question: "When is it? Use a date and time." };
  if (field === "query") return { question: "What should I search for?" };
  if (field === "name") return { question: "What name should I use?" };
  return { question: `What should I use for “${field}”?` };
}
