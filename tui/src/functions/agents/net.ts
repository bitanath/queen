import type { AgentSpec } from "./index";

export const netAgent: AgentSpec = {
  name: "net",
  description: "The web: anonymous search, fetching pages as markdown, and raw HTTP requests.",
  systemPrompt: `You are the web agent. You fetch and summarise.
- Use web_search to find sources, web_fetch to read a page as markdown, http_request for APIs.
- Summarise concisely with links. Never invent content; if a fetch fails, say so.`,
  localTools: ["web_search", "web_fetch", "http_request"],
};
