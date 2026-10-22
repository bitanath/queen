import { Agent, SlidingWindowConversationManager } from "@strands-agents/sdk";
import { z } from "zod";

import { ElthurModel } from "../strands-model";
import { parseListRequest } from "./list-request";
import { resolveReference } from "./session";
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


const BEE_NOUN = /\b(?:conversation|conversations|transcript|transcripts|fact|facts|todo|todos|task|tasks|daily|summary|summaries|brief|insight|insights|journal|journals|voice notes?|location|locations|visit|visits|photo|photos|profile|activity|bee|reminders?|what did i (?:say|talk|discuss|hear|mention)|where (?:am i|have i been)|my name|logged in|reachable)\b/;
const BEE_DATA = /\b(?:conversation|conversations|transcript|transcripts|fact|facts|todo|todos|task|tasks|daily|summary|summaries|brief|insight|insights|journal|journals|voice notes?|location|locations|visit|visits|photo|photos|profile|activity|my data|what did i (?:say|talk|discuss|hear|mention)|where (?:am i|have i been)|my name|logged in|reachable)\b/;
const BEE_WRITE_VERB = /\b(?:add|create|make|save|update|edit|delete|remove|complete|mark|dismiss|accept|log|track|remember)\b/;
const BEE_LIST_VERB = /\b(?:list|show|latest|newest|recent|review|which|what have i been up to)\b/;
const LATEST_KIND = /\b(?:last|latest|newest|oldest|first|second|third)\s+(?:\d+\s+)?(?:todo|todos|task|tasks|fact|facts|conversation|conversations|transcript|transcripts|journal|journals|voice notes?|insight|insights|daily|summary|summaries|photo|photos|location|locations|visit|visits)\b/;
const BEE_READ_VERB = /\b(?:what|where|who|when|why|how|did|find|search|summar|tell|get|fetch|look up|read|am i|is bee|has)\b/;
const OS_NOUN = /\b(?:remind|reminder|reminders|calendar|meeting|appointment|event|note|notes|email|mail|draft|imessage|text|message|clipboard|copy|paste|music|song|play|pause|skip|open|launch|url|browser|app|map|maps|address|directions|navigate|finder|reveal|folder|downloads|shortcut|shortcuts|battery|disk|dark mode|light mode|notification|notifications|notify|contact|contacts)\b/;
const OS_WRITE = /\b(?:add|create|make|save|update|delete|remove|send|draft|text|email|mail|open|launch|copy|paste|play|pause|skip|toggle|turn|remind|schedule|notify|show|reveal|run)\b/;
const WRITE_TARGET = /\b(?:delete|remove|complete|update|edit|mark|dismiss|accept)\b/;
const GREETING = /^(?:hi|hey|hello|thanks|thank you|what can you do|who are you|tell me a joke|what is \d|how do|i think|i'm liking|the sky|hmm|good morning|good night)\b/;

function dataText(step: StepResult, session: SessionState): string {
  const items = session.lastResult?.items ?? [];
  if (items.length > 0) {
    return items.map((item, index) => `${index + 1}. ${item.title}`).join("\n");
  }
  return step.text.slice(0, 4000);
}

function isCrossDomain(request: string): boolean {
  const lower = request.toLowerCase();
  if (/\b(?:voice notes?|bee notes?|journals?)\b/.test(lower)) return false;
  if (!BEE_DATA.test(lower)) return false;
  if (OS_NOUN.test(lower)) return true;
  return /\b(?:from|using|based on|about)\b/.test(lower) && BEE_WRITE_VERB.test(lower);
}

function nextAfterData(request: string, steps: StepResult[], session: SessionState): RouteDecision | undefined {
  const last = steps.at(-1);
  if (!last) return undefined;
  if (last.agent !== "bee_list" && last.agent !== "bee_read") return undefined;
  const lower = request.toLowerCase();

  if (OS_NOUN.test(lower) && OS_WRITE.test(lower)) {
    return {
      prompt: `Original request: ${request}\nUse this Bee data:\n${dataText(last, session)}`,
      agent: "os_action",
      clarify: false,
      final: true,
    };
  }

  if (WRITE_TARGET.test(lower) && (BEE_NOUN.test(lower) || session.lastResult)) {
    const item = resolveReference(session, request);
    if (!item) {
      return {
        prompt: "Which item do you mean?",
        agent: "done",
        clarify: true,
        final: true,
      };
    }
    return {
      prompt: `Original request: ${request}\nTarget item: id=${String(item.id)} title=${item.title}\nPerform the action.`,
      agent: "bee_write",
      clarify: false,
      final: true,
    };
  }

  return {
    prompt: last.text,
    agent: "done",
    clarify: false,
    final: true,
  };
}

export function fastDecision(request: string, session: SessionState, steps: StepResult[]): RouteDecision | undefined {
  const lower = request.toLowerCase();
  const next = nextAfterData(request, steps, session);
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

  if (session.activeDoc && /\b(?:this|that|these|those)\b/.test(lower) && !OS_NOUN.test(lower)) {
    return { prompt: request, agent: "bee_read", clarify: false, final: true };
  }

  if (/^(?:search|look up)\b/.test(lower)) {
    return { prompt: request, agent: "bee_read", clarify: false, final: true };
  }

  if (GREETING.test(lower) || (!BEE_NOUN.test(lower) && !OS_NOUN.test(lower) && !BEE_WRITE_VERB.test(lower))) {
    return { prompt: "", agent: "done", clarify: false, final: true };
  }

  if (/^add a todo\b|^create a task\b/.test(lower) && !/\b(?:bee|reminder|mac|macos)\b/.test(lower)) {
    return {
      prompt: "Do you mean a Bee todo or an Apple Reminder?",
      agent: "done",
      clarify: true,
      final: true,
    };
  }

  if (isCrossDomain(request)) {
    return {
      prompt: request,
      agent: BEE_LIST_VERB.test(lower) || LATEST_KIND.test(lower) ? "bee_list" : "bee_read",
      clarify: false,
      final: false,
    };
  }

  if (WRITE_TARGET.test(lower)) {
    const item = resolveReference(session, request);
    if (item) {
      return {
        prompt: `Original request: ${request}\nTarget item: id=${String(item.id)} title=${item.title}\nPerform the action.`,
        agent: "bee_write",
        clarify: false,
        final: true,
      };
    }
    if (BEE_NOUN.test(lower) && LATEST_KIND.test(lower)) {
      return { prompt: request, agent: "bee_list", clarify: false, final: false };
    }
    if (/\b(?:that|this|it)\b/.test(lower)) {
      return {
        prompt: "Which item do you mean?",
        agent: "done",
        clarify: true,
        final: true,
      };
    }
  }

  if (parseListRequest(request)) {
    return { prompt: request, agent: "bee_list", clarify: false, final: true };
  }

  if (BEE_NOUN.test(lower) && /\b(?:about|with|from|mention|say|said|talk|discuss|search|find)\b/.test(lower)) {
    return { prompt: request, agent: "bee_read", clarify: false, final: true };
  }

  if (
    OS_NOUN.test(lower) &&
    (OS_WRITE.test(lower) || BEE_READ_VERB.test(lower) || /\b(?:what'?s|what is|how'?s|how is)\b/.test(lower)) &&
    !/\b(?:voice notes?|bee notes?|journals?)\b/.test(lower)
  ) {
    const data = session.lastResult?.items ?? [];
    const reference = /\b(?:that|this|it|them|these|those|first|second|third|last|latest)\b/.test(lower);
    const context = reference && data.length > 0
      ? `\nUse this Bee data:\n${data.map((item) => `${item.index + 1}. ${item.title}`).join("\n")}`
      : "";
    return { prompt: `${request}${context}`, agent: "os_action", clarify: false, final: true };
  }

  if (BEE_WRITE_VERB.test(lower) && BEE_NOUN.test(lower)) {
    return { prompt: request, agent: "bee_write", clarify: false, final: true };
  }

  if (BEE_READ_VERB.test(lower) && BEE_NOUN.test(lower)) {
    return { prompt: request, agent: "bee_read", clarify: false, final: true };
  }

  return undefined;
}
