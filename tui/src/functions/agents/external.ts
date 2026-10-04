import type { AgentSpec } from "./index";

export const externalAgent: AgentSpec = {
  name: "external",
  description:
    "Reach outside Bee: make HTTP requests, fetch and read web pages, and run shell scripts.",
  systemPrompt: `You are the external specialist. You reach outside Bee to the web and the shell.
- Use http_request for APIs and web_fetch to read a page as markdown.
- Use bash for shell scripts only when the user asks; prefer read-only commands and explain what you will run.
- Return the relevant result, not raw logs.`,
  toolNames: [],
  extraTools: ["http_request", "web_fetch", "bash"],
};
