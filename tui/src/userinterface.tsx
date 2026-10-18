import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react";
import { createClipboard, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core";

import { HelpModal } from "./interface/help-modal";
import { ThemeModal } from "./interface/theme-modal";
import { CommandsModal } from "./interface/commands-modal";
import { AnswerModal } from "./interface/answer-modal";
import { StatusBar } from "./interface/status-bar";
import { useToast } from "./interface/toaster";
import { useTheme } from "./theme/use-theme";
import { Modal } from "./components/modal";
import { ToolApproval } from "./components/tool-approval";
import { allowAlways, setApprovalHandler, type ApprovalRequest } from "./utils/approval-broker";
import type { AnswerView } from "./utils/answer-view";

type ModalKind = "theme" | "help" | "commands";

type UiContextValue = {
  openModal: (modal: ModalKind) => void;
  closeModal: () => void;
  /** Open the answer viewer (markdown for prose, table for command results). */
  openAnswer: (view: AnswerView) => void;
  modalOpen: boolean;
};

const UiContext = createContext<UiContextValue>({
  openModal: () => {},
  closeModal: () => {},
  openAnswer: () => {},
  modalOpen: false,
});

export function useUi(): UiContextValue {
  return useContext(UiContext);
}

// MARK: - keybindings for theme
const THEME_KEY = "d";

function isCombo(key: { ctrl: boolean; name: string }, name: string): boolean {
  return key.ctrl && key.name === name;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [answer, setAnswer] = useState<AnswerView | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  const renderer = useRenderer();
  const showToast = useToast();
  const theme = useTheme();

  
  useEffect(() => {
    setApprovalHandler(
      (req) =>
        new Promise<boolean>((resolve) => {
          approvalResolver.current = resolve;
          setApproval(req);
        }),
    );
    return () => setApprovalHandler(null);
  }, []); //TODO Bridge tool execution to the approval modal. Headless runs have no handler.

  const resolveApproval = (ok: boolean, always = false) => {
    if (always && approval) allowAlways(approval.name);
    approvalResolver.current?.(ok);
    approvalResolver.current = null;
    setApproval(null);
  };

  
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
  }, [clipboard]); //TODO copy paste changes

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
    }
  });

  const value: UiContextValue = {
    openModal: (next) => setModal(next),
    closeModal: () => setModal(null),
    openAnswer: (view) => setAnswer(view),
    modalOpen: modal !== null || approval !== null || answer !== null,
  };

  return (
    <UiContext.Provider value={value}>
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        position="relative"
        backgroundColor={theme.colors.background}
      >
        <box flexGrow={1} minHeight={0}>
          {children}
        </box>
        <StatusBar />
        {modal === "theme" && <ThemeModal onClose={() => setModal(null)} />}
        {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
        {modal === "commands" && <CommandsModal onClose={() => setModal(null)} />}
        {answer && <AnswerModal view={answer} onClose={() => setAnswer(null)} />}
        {approval && (
          <Modal title="tool approval" onClose={() => resolveApproval(false)}>
            <ToolApproval
              name={approval.name}
              args={approval.args}
              risk={approval.risk}
              onApprove={() => resolveApproval(true)}
              onDeny={() => resolveApproval(false)}
              onAlwaysAllow={() => resolveApproval(true, true)}
              active
            />
          </Modal>
        )}
      </box>
    </UiContext.Provider>
  );
}
