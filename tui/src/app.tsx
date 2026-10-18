import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";
import { useEffect, useState } from "react";

import { BeeSplash } from "./components/bee-splash";
import { loadRecentConversations, placeholderDocument, type QueenDocument } from "./documents";
import { DOC_SYSTEM } from "./functions/document-chat";
import { Screen } from "./screen";
import { ThemeProvider } from "./theme/provider";
import { loadInitialTheme } from "./theme/themes";
import { Toaster } from "./interface/toaster";
import { warmModel } from "./utils/queen-ffi";

export const QUEEN_VERSION = "v1.2.0";

// Boot flow: read the last five conversations, then hand the main screen a
// single selected document. The loading screen is the same bee splash used for
// actions and chat thinking.
function QueenApp({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [docs, setDocs] = useState<QueenDocument[]>([]);
  const [splash, setSplash] = useState<string | null>("reading your last 5 conversations…");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    // Prime the weights behind the splash so the first chat turn doesn't pay the
    // model-load latency. (DOC_SYSTEM matches the system prompt the chat uses.)
    setTimeout(() => {
      try {
        warmModel(DOC_SYSTEM);
      } catch {
        /* no local model available; chat will surface the error */
      }
    }, 0);
    loadRecentConversations(5)
      .then((records) => {
        if (!alive) return;
        setDocs(
          records.length > 0
            ? records
            : [
                placeholderDocument(
                  "No conversations yet",
                  "# No conversations yet\n\nBee hasn't captured anything recent. Once it does, the last five conversations will appear here.",
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

  return <Screen docs={docs} initialPrompt={initialPrompt} />;
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
