import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";
import { useCallback, useEffect, useState } from "react";

import { BeeSplash } from "./components/bee-splash";
import { loadRecentDocuments, placeholderDocument, type QueenDocument } from "./documents";
import { ensureAnalytics } from "./functions/analytics/store";
import { DOC_SYSTEM } from "./functions/document-chat";
import { Screen } from "./screen";
import { ThemeProvider } from "./theme/provider";
import { loadInitialTheme } from "./theme/themes";
import { Toaster } from "./interface/toaster";
import { warmModel } from "./utils/queen-ffi";

export const QUEEN_VERSION = "v1.2.0";


function QueenApp({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [docs, setDocs] = useState<QueenDocument[]>([]);
  const [splash, setSplash] = useState<string | null>("reading your latest documents…");
  const [loaded, setLoaded] = useState(false);

  const updateDocument = useCallback((doc: QueenDocument) => {
    setDocs((prev) => prev.map((item) => (item.key === doc.key ? doc : item)));
  }, []);

  useEffect(() => {
    let alive = true;
   
    setTimeout(() => {
      try {
        warmModel(DOC_SYSTEM);
      } catch {
        console.error("No local model available") //XXX this should never happen
      }
    }, 0);
    
    ensureAnalytics(); //TODO: Factor analysis wee hew
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
  }, []);

  if (!loaded || splash !== null) {
    return <BeeSplash words={splash ?? "reading your Bee memory…"} hint="connecting to Bee…" />;
  }

  return <Screen docs={docs} initialPrompt={initialPrompt} onDocumentUpdate={updateDocument} />;
}

export function render(initialPrompt = "") {
  const run = async () => {
    const renderer = await createCliRenderer();
    createRoot(renderer).render(
      <ThemeProvider theme={loadInitialTheme()}>
        <Toaster>
          <QueenApp initialPrompt={initialPrompt} />
        </Toaster>
      </ThemeProvider>,
    );
  };
  void run();
}
