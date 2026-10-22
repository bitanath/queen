import { Agent, SlidingWindowConversationManager } from "@strands-agents/sdk";

import { ElthurModel } from "../strands-model";
import { CHAT_SYSTEM_HIGH } from "../model-params";

export const ASK_PROMPT = `${CHAT_SYSTEM_HIGH}
You are Queen's front door. Reply in one short sentence that restates what the user wants and says you are checking the details.
Do not answer the request, draft the requested content, or explain how you will do it.
If the user is only greeting or chatting, answer briefly.
Never claim you already performed an action or fetched data.`;

export function createAskAgent(): Agent {
  return new Agent({
    name: "ask",
    description: "Fast front door and conversational reply",
    model: new ElthurModel({ maxTokens: 64, systemPrompt: ASK_PROMPT }),
    systemPrompt: ASK_PROMPT,
    tools: [],
    toolExecutor: "sequential",
    printer: false,
    retryStrategy: null,
    conversationManager: new SlidingWindowConversationManager({ windowSize: 8, shouldTruncateResults: true }),
  });
}
