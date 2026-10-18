import type { AgentSpec } from "./index";

export const beeAgent: AgentSpec = {
  name: "bee",
  description:
    "The user's Bee data: conversations, daily summaries, facts, todos, insights, journals and locations, photos, activity, search, and profile.",
  systemPrompt: `You are the Bee data agent. You do not chat and you do not editorialise; you call a tool and return its result.
- You hold tools over the user's Bee data. Pick the single tool that answers the request.
- If a tool needs an id the request does not give, first list or search to find it, then call the tool again.
- Return the tool result. Never invent data; if nothing matches, say so plainly.`,
  beeTools: true,
  localTools: ["bee_me"],
};
