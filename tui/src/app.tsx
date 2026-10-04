import { Dashboard } from "./dashboard";
import { createRoot } from "@opentui/react";
import { ThemeProvider } from "./theme/provider";
import { loadInitialTheme } from "./theme/themes";
import { AppShell } from "./userinterface";
import { Toaster } from "./interface/toaster";
import { createCliRenderer } from "@opentui/core";

export const QUEEN_VERSION = "v0.1.0";

export function render() {
  const run = async () => {
    const renderer = await createCliRenderer();
    createRoot(renderer).render(
      <ThemeProvider theme={loadInitialTheme()}>
        <Toaster>
          <AppShell>
            <Dashboard />
          </AppShell>
        </Toaster>
      </ThemeProvider>,
    );
  };
  void run();
}
