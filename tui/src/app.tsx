import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";
import { useCallback, useEffect, useState } from "react";

import { BeeSplash } from "./components/bee-splash";
import { loadRecentDocuments, placeholderDocument, type QueenDocument } from "./documents";
import { ensureAnalytics } from "./functions/analytics/store";
import { orchestratorPrompt } from "./functions/agents";
import type { DocFilter } from "./functions/ui-bridge";
import { LoginCard } from "./interface/login-card";
import { Toaster } from "./interface/toaster";
import { McpProvider } from "./mcp";
import { Screen } from "./screen";
import { ThemeProvider } from "./theme/provider";
import { loadInitialTheme } from "./theme/themes";
import { AppShell } from "./userinterface";
import { isLoggedIn } from "./utils/bee-com-bridge";
import { warmModel } from "./utils/queen-ffi";

export const QUEEN_VERSION = "v1.2.0";

type Auth = "checking" | "in" | "out";

function QueenApp({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [auth, setAuth] = useState<Auth>("checking");
  const [docs, setDocs] = useState<QueenDocument[]>([]);
  const [splash, setSplash] = useState<string | null>("reading your latest documents…");
  const [loaded, setLoaded] = useState(false);

  // Login gate: decide before showing anything data-shaped.
  useEffect(() => {
    let alive = true;
    isLoggedIn()
      .then((ok) => {
        if (alive) setAuth(ok ? "in" : "out");
      })
      .catch(() => {
        if (alive) setAuth("out");
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateDocument = useCallback((doc: QueenDocument) => {
    setDocs((prev) => prev.map((item) => (item.key === doc.key ? doc : item)));
  }, []);

  // Display actions re-drive the panels through this.
  const refreshDocuments = useCallback(async (filter: DocFilter = {}): Promise<QueenDocument[]> => {
    const records = await loadRecentDocuments({
      limit: filter.limit ?? 20,
      ...(filter.kinds ? { kinds: filter.kinds } : {}),
      ...(filter.from !== undefined ? { from: filter.from } : {}),
      ...(filter.to !== undefined ? { to: filter.to } : {}),
      ...(filter.query ? { query: filter.query } : {}),
      sort: "recency",
    });
    if (records.length > 0) setDocs(records);
    return records;
  }, []);

  useEffect(() => {
    if (auth !== "in") return;
    let alive = true;

    setTimeout(() => {
      try {
        warmModel(orchestratorPrompt);
      } catch {
        console.error("No local model available"); //XXX this should never happen
      }
    }, 0);

    ensureAnalytics();
    loadRecentDocuments({ limit: 20 })
      .then((records) => {
        if (!alive) return;
        setDocs(
          records.length > 0
            ? records
            : [
                placeholderDocument(
                  "Nothing yet",
                  "# Nothing yet\n\nBee hasn't captured anything recent. Once it does, the latest documents will appear here.",
                ),
              ],
        );
      })
      .catch((error) => {
        if (!alive) return;
        const message = error instanceof Error ? error.message : String(error);
        setDocs([
          placeholderDocument(
            "Bee unavailable",
            `# Bee unavailable\n\n${message}\n\nRun \`bee login\` (or reconnect the Bee app) and relaunch Queen.`,
          ),
        ]);
      })
      .finally(() => {
        if (!alive) return;
        setLoaded(true);
        setSplash(null);
      });
    return () => {
      alive = false;
    };
  }, [auth]);

  if (auth === "checking") {
    return <BeeSplash words="connecting to Bee…" hint="checking credentials…" />;
  }

  // Logged out: skip the document splash entirely and go straight to login.
  if (auth === "out") {
    return <LoginCard onConnected={() => setAuth("in")} />;
  }

  if (!loaded || splash !== null) {
    return <BeeSplash words={splash ?? "reading your Bee memory…"} hint="connecting to Bee…" />;
  }

  return (
    <AppShell>
      <Screen
        docs={docs}
        initialPrompt={initialPrompt}
        onDocumentUpdate={updateDocument}
        onRefresh={refreshDocuments}
      />
    </AppShell>
  );
}

export function render(initialPrompt = "") {
  const run = async () => {
    const renderer = await createCliRenderer();
    createRoot(renderer).render(
      <ThemeProvider theme={loadInitialTheme()}>
        <Toaster>
          <McpProvider>
            <QueenApp initialPrompt={initialPrompt} />
          </McpProvider>
        </Toaster>
      </ThemeProvider>,
    );
  };
  void run();
}
