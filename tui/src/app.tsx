import { Dashboard } from "./dashboard";
import { createRoot } from "@opentui/react";
import { ThemeProvider } from "./theme/provider";
import { loadInitialTheme } from "./theme/themes";
import { AppShell } from "./userinterface";
import { Toaster } from "./components/toaster";
import { createCliRenderer } from "@opentui/core";

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
