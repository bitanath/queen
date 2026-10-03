// App shell: hosts the dashboard and the modal layer, and owns the global
// shortcuts. The two-key combos are ctrl+option+<letter>; `meta` is accepted as
// an Alt fallback for terminals that report Option/Alt as meta.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";

import { HelpModal } from "./components/help-modal";
import { ThemeModal } from "./components/theme-modal";

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

// MARK: - keybindings. Change these two lines to remap; they are matched on the
// logical key name, so they survive Windows/other keyboard layouts.
const THEME_KEY = "t";
const HELP_KEY = "h";

function isCombo(key: { ctrl: boolean; option: boolean; meta: boolean; name: string }, name: string): boolean {
  return key.ctrl && (key.option || key.meta) && key.name === name;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalKind | null>(null);

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
