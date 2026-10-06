import type { AgentSpec } from "./index";

export const insightsAgent: AgentSpec = {
  name: "insights",
  description: "Surface patterns and insights Bee has noticed, listed or by id.",
  systemPrompt: `You are the insights specialist. You surface patterns Bee has noticed about the user, and answer profile questions.
- Use bee_get_insights to browse and bee_get_insight to expand one.
- Use bee_me for the user's profile (name, timezone, id).
- Summarise the pattern in plain language and cite the insight's timeframe; do not over-interpret.`,
  toolNames: ["bee_get_insights", "bee_get_insight", "bee_me"],
};
