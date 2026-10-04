import type { AgentSpec } from "./index";

export const conversationAgent: AgentSpec = {
  name: "conversation",
  description:
    "Recall what the user said, heard, or did: search across conversations, summaries and facts, today's wearable context, recent activity, conversation transcripts and daily summaries.",
  systemPrompt: `You are the conversation specialist. You recall what the user said, heard, and did, using Bee's captured conversations and daily summaries.
- Start with bee_search for most questions, then drill in with conversation transcripts or daily summaries when a specific day or conversation matters.
- Use bee_get_today for "today", bee_get_recent_activity for "what have I been up to", and bee_get_related_conversations to find surrounding context.
- Answer only from the retrieved Bee data. Quote short snippets with rough times. Never invent details.`,
  toolNames: [
    "bee_search",
    "bee_get_today",
    "bee_get_recent_activity",
    "bee_list_conversations",
    "bee_get_conversation",
    "bee_get_conversation_transcript",
    "bee_get_related_conversations",
    "bee_list_daily_summaries",
    "bee_get_daily_summary",
  ],
};
