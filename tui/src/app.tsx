// Queen entry: a termcn-themed bento dashboard (see src/dashboard.tsx). The chat
// pane embedded in the bottom stack is the original chat UI (src/chat.tsx).
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Dashboard } from "./dashboard";
import { ThemeProvider } from "./theme/provider";
import { opencodeTheme } from "./theme/opencode";

export function render() {
  const run = async () => {
    const renderer = await createCliRenderer();
    createRoot(renderer).render(
      <ThemeProvider theme={opencodeTheme}>
        <Dashboard />
      </ThemeProvider>,
    );
  };
  void run();
}
