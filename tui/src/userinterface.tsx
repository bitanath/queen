import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react";
import { createClipboard, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core";

import { HelpModal } from "./components/help-modal";
import { ThemeModal } from "./components/theme-modal";
import { useToast } from "./components/toaster";

type ModalKind = "theme" | "help";

type UiContextValue = {
  openModal: (modal: ModalKind) => void;
  closeModal: () => void;
  modalOpen: boolean;
};

const UiContext = createContext<UiContextValue>({
  openModal: () => {},
  closeModal: () => {},
  modalOpen: false,
});

export function useUi(): UiContextValue {
  return useContext(UiContext);
}

// MARK: - keybindings for help and theme change
const THEME_KEY = "t";
const HELP_KEY = "p";

function isCombo(key: { ctrl: boolean; name: string }, name: string): boolean {
  return key.ctrl && key.name === name;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalKind | null>(null);
  const renderer = useRenderer();
  const showToast = useToast();

  // Native (NSPasteboard) clipboard with an OSC 52 fallback, built once.
  const clipboard = useMemo(
    () =>
      createClipboard({
        host: createHostClipboard(),
        terminal: createRendererClipboardAdapter(renderer),
      }),
    [renderer],
  );
  useEffect(() => {
    return () => {
      void clipboard.dispose();
    };
  }, [clipboard]);

  // Selecting text (mouse drag) auto-copies it and confirms with a toast.
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (!text.trim()) return;
    void clipboard
      .writeText(text, { destination: "best-available" })
      .then((result) => {
        const copied =
          result.host.status === "written" || result.terminal.status === "attempted";
        showToast(copied ? "Copied to clipboard" : "Copy failed", {
          variant: copied ? "success" : "error",
        });
      })
      .catch(() => showToast("Copy failed", { variant: "error" }));
  });

  useKeyboard((key) => {
    if (isCombo(key, THEME_KEY)) {
      key.preventDefault();
      setModal("theme");
    } else if (isCombo(key, HELP_KEY)) {
      key.preventDefault();
      setModal("help");
    }
  });

  const value: UiContextValue = {
    openModal: (next) => setModal(next),
    closeModal: () => setModal(null),
    modalOpen: modal !== null,
  };

  return (
    <UiContext.Provider value={value}>
      <box flexDirection="column" width="100%" height="100%" position="relative">
        {children}
        {modal === "theme" && <ThemeModal onClose={() => setModal(null)} />}
        {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      </box>
    </UiContext.Provider>
  );
}
