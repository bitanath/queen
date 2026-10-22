import { Agent, SlidingWindowConversationManager } from "@strands-agents/sdk";
import { z } from "zod";

import { ElthurModel } from "../strands-model";
import { parseListRequest } from "./list-request";
import { referenceItemBlock, targetLine } from "./reference-content";
import { referenceLine, referenceReadTool, resolveReference, resolveRequestedReference } from "./session";
import type { ResolvedReference } from "./session";
import type { RouteDecision, SessionState, StepResult } from "./types";

export const ORCHESTRATOR_PROMPT = `You are Queen's dispatcher. Choose one next step. Return only the structured decision.
Available agents:
- bee_read: search, read, or summarize the user's Bee data.
- bee_list: list or fetch the latest Bee items.
- bee_write: create, update, complete, or delete Bee facts, todos, or suggestions.
- os_action: perform a macOS/Linux action such as notes, reminders, calendar, mail, messages, music, clipboard, browser, maps, Finder, shortcuts, notifications, contacts, or system status.
- done: return a final message to the user, or end when the front door already answered.

Rules:
- Do not choose tools. Choose only the agent.
- Make prompt explicit. Include the action and object, and resolved IDs or item text when available. Never send only "that" or "it".
- If the user asks for data and then an action, choose the read/list step first. The next decision will see the result.
- If a write needs a target that is not in the request or session, choose bee_list first.
- If essential information is missing and the user can supply it, set clarify=true, choose done, and ask one short question.
- If the request is already answered by the front door or is pure conversation, choose done with an empty prompt.
- Set final=true only when the selected agent's result is the final response and no further step is needed.
- Never repeat the same step after a successful result.`;

const DecisionSchema = z.object({
  prompt: z.string().describe("Task for the agent, final message, or clarification question"),
  agent: z.enum(["bee_read", "bee_list", "bee_write", "os_action", "done"]),
  clarify: z.boolean().describe("True when prompt is a question for the user"),
  final: z.boolean().optional().describe("True when the selected agent's result is final"),
});

export function createOrchestratorAgent(): Agent {
  return new Agent({
    name: "orchestrator",
    description: "Dispatches Bee and OS work",
    model: new ElthurModel({ maxTokens: 256, systemPrompt: ORCHESTRATOR_PROMPT }),
    systemPrompt: ORCHESTRATOR_PROMPT,
    tools: [],
    structuredOutputSchema: DecisionSchema,
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: new SlidingWindowConversationManager({ windowSize: 16, shouldTruncateResults: true }),
  });
}

export function decisionOf(result: { structuredOutput?: unknown }): RouteDecision | undefined {
  const parsed = DecisionSchema.safeParse(result.structuredOutput);
  return parsed.success ? parsed.data : undefined;
}

export const orchestratorPrompt = ORCHESTRATOR_PROMPT;


const BEE_NOUN = /\b(?:conversation|conversations|transcript|transcripts|fact|facts|todo|todos|task|tasks|daily|summary|summaries|brief|insight|insights|journal|journals|voice notes?|location|locations|visit|visits|photo|photos|profile|activity|bee|alarms?|what did i (?:say|talk|discuss|hear|mention)|where (?:am i|have i been)|my name|logged in|reachable)\b/;
const BEE_DATA = /\b(?:conversation|conversations|transcript|transcripts|fact|facts|todo|todos|task|tasks|daily|summary|summaries|brief|insight|insights|journal|journals|voice notes?|location|locations|visit|visits|photo|photos|profile|activity|alarms?|my data|what did i (?:say|talk|discuss|hear|mention)|where (?:am i|have i been)|my name|logged in|reachable)\b/;
const BEE_WRITE_VERB = /\b(?:add|create|make|save|update|edit|delete|remove|complete|mark|dismiss|accept|log|track|remember|rename|move|reschedule|alarm|change)\b/;
const BEE_LIST_VERB = /\b(?:list|show|latest|newest|recent|review|which|what have i been up to)\b/;
const LATEST_KIND = /\b(?:last|latest|newest|oldest|first|second|third)\s+(?:\d+\s+)?(?:todo|todos|task|tasks|fact|facts|conversation|conversations|transcript|transcripts|journal|journals|voice notes?|insight|insights|daily|summary|summaries|photo|photos|location|locations|visit|visits)\b/;
const BEE_READ_VERB = /\b(?:what|where|who|when|why|how|did|find|search|summar|tell|get|fetch|look up|read|am i|is bee|has)\b/;
const OS_NOUN = /\b(?:remind|reminder|reminders|calendar|meeting|appointment|event|note|notes|email|mail|draft|imessage|text|message|clipboard|copy|paste|music|song|play|pause|skip|open|launch|url|browser|app|map|maps|address|directions|navigate|finder|reveal|folder|downloads|shortcut|shortcuts|battery|disk|dark mode|light mode|notification|notifications|notify|contact|contacts)\b/;
const OS_WRITE = /\b(?:add|create|make|save|set|put|write|compose|update|delete|remove|send|draft|text|email|mail|open|launch|copy|paste|play|pause|stop|skip|next|previous|toggle|turn|remind|schedule|notify|show|reveal|run|start|move|rename)\b/;
const WRITE_TARGET = /\b(?:delete|remove|complete|update|edit|mark|dismiss|accept|rename|move|reschedule|alarm|change)\b/;
const ORDINAL_REFERENCE = /\b(?:first|second|third)\b/i;
const MULTI_REFERENCE = /\b(?:last|latest|newest|oldest|first|recent)\s+\d+\b|\b(?:all|both|any)\b/;
const PLURAL_REFERENCE = /\b(?:these|those|them|all|both|any)\b/;
const OS_JOURNAL = /\b(?:voice notes?|bee notes?|journals?)\b/;
const OS_ACTION_VERB = /\b(?:add|create|make|save|set|put|write|compose|schedule|remind|send|draft|text|email|mail|imessage|message|copy|paste|play|pause|stop|skip|toggle|turn|notify|run|reveal|start|move|rename|alarm)\b/;
const OS_CONTENT_ACTION = /\b(?:note|notes|email|mail|draft|message|imessage|text|clipboard|copy|paste|notification|notify)\b/;
const OS_IMPLICIT_NOUN = /\b(?:reminders?|notes?|calendar|events?|email|mail|drafts?|messages?|imessage|notifications?)\b/;
const DEMONSTRATIVE = /\b(?:this|these|those|them)\b|\bthat\b(?!\s+(?:i|you|he|she|we|they|it|the|a|an|my|our|your|his|her|their)\b)/;
const REFERENCE_WORD = new RegExp(`${DEMONSTRATIVE.source}|\\b(?:it|first|second|third|last|latest|newest|oldest|most recent)\\b`);
const READ_QUESTION = /^\s*(?:(?:okay|please|yes|yeah|sure|no|now)[, ]+)*(?:show|list|read|display|what|which|who|when|where|why|how|tell me|do i have)\b/;
const QUESTION = /^\s*(?:is|are|was|were|do|does|did|can|could|would|should|will|what|which|who|when|where|why|how)\b/;
const GREETING = /^(?:hi|hey|hello|thanks|thank you|what can you do|who are you|tell me a joke|what is \d|how do|i think|i'm liking|the sky|hmm|good morning|good night)\b/;

function dataText(step: StepResult, session: SessionState): string {
  if (step.direct === true && step.text.trim().length > 0) {
    return step.text.slice(0, 4000);
  }
  const items = session.lastResult?.items ?? [];
  if (items.length > 0) {
    return items.map((item, index) => `${index + 1}. ${item.title}`).join("\n");
  }
  return step.text.slice(0, 4000);
}

function isCrossDomain(request: string): boolean {
  const lower = request.toLowerCase();
  if (OS_JOURNAL.test(lower)) return false;
  if (!BEE_DATA.test(lower)) return false;
  if (OS_NOUN.test(lower)) return true;
  return /\b(?:from|using|based on|about)\b/.test(lower) && BEE_WRITE_VERB.test(lower);
}

function clarifyDecision(question: string, request: string): RouteDecision {
  return {
    prompt: question,
    intent: request,
    agent: "done",
    clarify: true,
    final: true,
  };
}

function dataBlock(session: SessionState, text?: string): string {
  if (text !== undefined && text.trim().length > 0) {
    return `Use this Bee data:\n${text.trim().slice(0, 4000)}`;
  }
  const items = session.lastResult?.items ?? [];
  if (items.length === 0) return "";
  const block = items
    .slice(0, 12)
    .map((item, index) => referenceItemBlock(item, index))
    .join("\n\n");
  return `Use this Bee data:\n${block.slice(0, 4000)}`;
}

function osDecision(
  request: string,
  session: SessionState,
  reference: ResolvedReference | undefined,
  options: { dataText?: string; includeData?: boolean; afterData?: boolean } = {},
): RouteDecision {
  const lower = request.toLowerCase();
  const plural = PLURAL_REFERENCE.test(lower) || MULTI_REFERENCE.test(lower);
  const single = reference !== undefined && !plural;
  const lines = [request];
  if (single) lines.push(targetLine(reference, session));
  const includeData =
    options.includeData ??
    (options.afterData === true || plural || (!single && REFERENCE_WORD.test(lower)));
  if (includeData) {
    const data =
      options.dataText !== undefined
        ? options.dataText.trim().length > 0
          ? `Use this Bee data:\n${options.dataText.trim().slice(0, 4000)}`
          : ""
        : dataBlock(session);
    if (data.length > 0) lines.push(data);
  }
  return {
    prompt: lines.join("\n"),
    intent: request,
    agent: "os_action",
    clarify: false,
    final: true,
    ...(single && reference ? { reference } : {}),
  };
}


function osActionDecision(
  request: string,
  session: SessionState,
  reference: ResolvedReference | undefined,
  options: { afterData?: boolean; dataText?: string; includeData?: boolean } = {},
): RouteDecision | undefined {
  const lower = request.toLowerCase();
  if (!OS_NOUN.test(lower) || OS_JOURNAL.test(lower)) return undefined;

  const plural = PLURAL_REFERENCE.test(lower) || MULTI_REFERENCE.test(lower);
  const target = plural ? undefined : reference;

  if (!options.afterData) {
    if (!reference && REFERENCE_WORD.test(lower) && !BEE_DATA.test(lower) && !READ_QUESTION.test(lower)) {
      return clarifyDecision("Which item do you mean? Include the item text or a bee:// URI.", request);
    }
    if (!reference && DEMONSTRATIVE.test(lower) && !READ_QUESTION.test(lower)) {
      return clarifyDecision("Which item do you mean? Include the item text or a bee:// URI.", request);
    }
    if (MULTI_REFERENCE.test(lower)) return undefined;
    if (!reference && BEE_DATA.test(lower)) return undefined;
  }

  const strong = OS_ACTION_VERB.test(lower);
  const implicit =
    Boolean(target) &&
    OS_IMPLICIT_NOUN.test(lower) &&
    !READ_QUESTION.test(lower) &&
    !QUESTION.test(lower);
  if (!strong && !implicit) return undefined;


  if (!options.afterData && target && referenceReadTool(target.kind) && OS_CONTENT_ACTION.test(lower)) {
    return readReferenceDecision(request, target, false);
  }

  const includeData =
    options.includeData ??
    (options.afterData === true || plural || (!target && REFERENCE_WORD.test(lower)));
  return osDecision(request, session, target, {
    ...(options.afterData && options.dataText !== undefined ? { dataText: options.dataText } : {}),
    includeData,
    afterData: options.afterData,
  });
}

function nextAfterData(
  request: string,
  steps: StepResult[],
  session: SessionState,
  reference: ResolvedReference | undefined,
): RouteDecision | undefined {
  const last = steps.at(-1);
  if (!last) return undefined;
  if (last.agent !== "bee_list" && last.agent !== "bee_read") return undefined;
  const lower = request.toLowerCase();
  const plural = PLURAL_REFERENCE.test(lower) || MULTI_REFERENCE.test(lower);
  const includeData = plural || !reference || (last.direct === true && OS_CONTENT_ACTION.test(lower));

  const os = osActionDecision(request, session, reference, {
    afterData: true,
    dataText: dataText(last, session),
    includeData,
  });
  if (os) return os;

  if (WRITE_TARGET.test(lower) && (BEE_NOUN.test(lower) || session.lastResult)) {
    const item = reference?.item ?? resolveReference(session, request);
    const id = reference?.id ?? item?.id;
    if (id === undefined) return clarifyDecision("Which item do you mean?", request);
    const title = reference?.title ?? item?.title;
    return {
      prompt: `Original request: ${request}\nTarget item: id=${String(id)}${title ? ` title=${title}` : ""}\nPerform the action.`,
      intent: request,
      agent: "bee_write",
      clarify: false,
      final: true,
      ...(reference ? { reference } : {}),
    };
  }

  return {
    prompt: last.text,
    agent: "done",
    clarify: false,
    final: true,
  };
}

function readReferenceDecision(
  request: string,
  reference: ResolvedReference,
  final = true,
): RouteDecision {
  return {
    prompt: `${request}\n${referenceLine(reference)}`,
    intent: request,
    agent: "bee_read",
    clarify: false,
    final,
    reference,
  };
}

export function fastDecision(request: string, session: SessionState, steps: StepResult[]): RouteDecision | undefined {
  const lower = request.toLowerCase();
  const reference = resolveRequestedReference(session, request);
  const next = nextAfterData(request, steps, session, reference);
  if (next) return next;

  if (steps.length > 0) {
    const last = steps.at(-1)!;
    return {
      prompt: last.text,
      agent: "done",
      clarify: false,
      final: true,
    };
  }

  // Explicit OS actions win over Bee read/list heuristics. This is what keeps
  // "create a reminder/note/email from this" from turning into a list.
  const os = osActionDecision(request, session, reference);
  if (os) return os;

  if (session.activeDoc && /\b(?:this|that|these|those)\b/.test(lower) && !OS_NOUN.test(lower)) {
    return reference
      ? readReferenceDecision(request, reference)
      : { prompt: request, intent: request, agent: "bee_read", clarify: false, final: true };
  }

  if (/^(?:search|look up)\b/.test(lower)) {
    return { prompt: request, intent: request, agent: "bee_read", clarify: false, final: true };
  }

  if (GREETING.test(lower)) {
    return { prompt: "", agent: "done", clarify: false, final: true, conversational: true };
  }

  if (!BEE_NOUN.test(lower) && !OS_NOUN.test(lower) && !BEE_WRITE_VERB.test(lower)) {
    if (reference) return readReferenceDecision(request, reference);
    if (ORDINAL_REFERENCE.test(lower)) {
      return clarifyDecision("Which item do you mean?", request);
    }
    return { prompt: "", agent: "done", clarify: false, final: true };
  }

  if (/^add a todo\b|^create a task\b/.test(lower) && !/\b(?:bee|reminder|mac|macos)\b/.test(lower)) {
    return clarifyDecision("Do you mean a Bee todo or an Apple Reminder?", request);
  }

  if (isCrossDomain(request)) {
    return {
      prompt: request,
      intent: request,
      agent: BEE_LIST_VERB.test(lower) || LATEST_KIND.test(lower) ? "bee_list" : "bee_read",
      clarify: false,
      final: false,
    };
  }

  if (WRITE_TARGET.test(lower)) {
    const resolved = resolveRequestedReference(session, request);
    const item = resolved?.item ?? resolveReference(session, request);
    const id = resolved?.id ?? item?.id;
    if (id !== undefined) {
      const title = resolved?.title ?? item?.title;
      return {
        prompt: `Original request: ${request}\nTarget item: id=${String(id)}${title ? ` title=${title}` : ""}\nPerform the action.`,
        intent: request,
        agent: "bee_write",
        clarify: false,
        final: true,
        ...(resolved ? { reference: resolved } : {}),
      };
    }
    if (BEE_NOUN.test(lower) && LATEST_KIND.test(lower)) {
      return { prompt: request, intent: request, agent: "bee_list", clarify: false, final: false };
    }
    if (/\b(?:that|this|it|first|second|third)\b/.test(lower)) {
      return clarifyDecision("Which item do you mean?", request);
    }
  }

  if (
    reference &&
    !WRITE_TARGET.test(lower) &&
    !BEE_WRITE_VERB.test(lower) &&
    !OS_NOUN.test(lower) &&
    !MULTI_REFERENCE.test(lower)
  ) {
    return readReferenceDecision(request, reference);
  }

  if (parseListRequest(request)) {
    return { prompt: request, intent: request, agent: "bee_list", clarify: false, final: true };
  }

  if (BEE_NOUN.test(lower) && /\b(?:about|with|from|mention|say|said|talk|discuss|search|find)\b/.test(lower)) {
    return reference
      ? readReferenceDecision(request, reference)
      : { prompt: request, intent: request, agent: "bee_read", clarify: false, final: true };
  }

  if (
    OS_NOUN.test(lower) &&
    (OS_WRITE.test(lower) || BEE_READ_VERB.test(lower) || /\b(?:what'?s|what is|how'?s|how is)\b/.test(lower)) &&
    !OS_JOURNAL.test(lower)
  ) {
    const hasReference = REFERENCE_WORD.test(lower);
    return osDecision(request, session, hasReference ? reference : undefined, {
      includeData: hasReference,
    });
  }

  if (BEE_WRITE_VERB.test(lower) && BEE_NOUN.test(lower)) {
    return { prompt: request, intent: request, agent: "bee_write", clarify: false, final: true };
  }

  if (BEE_READ_VERB.test(lower) && BEE_NOUN.test(lower)) {
    return reference
      ? readReferenceDecision(request, reference)
      : { prompt: request, intent: request, agent: "bee_read", clarify: false, final: true };
  }

  return undefined;
}
