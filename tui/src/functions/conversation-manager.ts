import {
  AfterInvocationEvent,
  ConversationManager,
  type ConversationManagerReduceOptions,
  type Message,
} from "@strands-agents/sdk";

/** Rough token estimate, matching strands-model.ts's char/4 accounting. */
function estimateTokens(messages: readonly Message[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "textBlock") chars += block.text.length;
      else chars += 64; // media / nested tool payloads: rough upper bound
    }
  }
  return Math.ceil(chars / 4);
}

function isPlainUser(message: Message | undefined): boolean {
  if (!message || message.role !== "user") return false;
  return !message.content.some((block) => block.type === "toolResultBlock");
}

/**
 * Keeps history under a token budget.
 *
 * Unlike a fixed message-count window, this only trims once the estimated token
 * budget is exceeded, so normal chat is append-only — which keeps the engine's
 * prefix KV cache hitting turn after turn. The first `pinFirst` messages (the
 * document context) are always retained, and trimming starts on a plain user
 * turn so tool-use/result pairs never dangle.
 */
export class TokenBudgetConversationManager extends ConversationManager {
  readonly name = "queen:token-budget-conversation-manager";
  private readonly budget: number;
  private readonly pinFirst: number;

  constructor(opts: { budget: number; pinFirst?: number }) {
    super();
    this.budget = Math.max(512, Math.floor(opts.budget));
    this.pinFirst = Math.max(0, opts.pinFirst ?? 1);
  }

  override initAgent(agent: Parameters<ConversationManager["initAgent"]>[0]): void {
    super.initAgent(agent);
    agent.addHook(AfterInvocationEvent, (event) => {
      this.trim(event.agent.messages);
    });
  }

  override reduce({ agent }: ConversationManagerReduceOptions): boolean {
    return this.trim(agent.messages);
  }

  private trim(messages: Message[]): boolean {
    if (estimateTokens(messages) <= this.budget || messages.length <= this.pinFirst + 1) {
      return false;
    }

    const pinned = messages.slice(0, this.pinFirst);
    let total = estimateTokens(pinned);
    const keep: Message[] = [];
    for (let i = messages.length - 1; i >= this.pinFirst; i -= 1) {
      const message = messages[i]!;
      const cost = estimateTokens([message]);
      if (total + cost > this.budget && keep.length > 0) break;
      total += cost;
      keep.unshift(message);
    }

    // History must begin on a plain user turn (never a dangling tool result).
    while (keep.length > 0 && !isPlainUser(keep[0])) keep.shift();
    if (keep.length === 0) return false;

    const next = [...pinned, ...keep];
    if (next.length === messages.length) return false;
    messages.splice(0, messages.length, ...next);
    return true;
  }
}
