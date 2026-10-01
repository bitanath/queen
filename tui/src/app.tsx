import { Dashboard } from "./dashboard";
import { createRoot } from "@opentui/react";
import { ThemeProvider } from "./theme/provider";
import { opencodeTheme } from "./theme/opencode";
import { createCliRenderer } from "@opentui/core";

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
