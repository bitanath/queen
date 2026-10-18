/* @jsxImportSource @opentui/react */
import { SyntaxStyle, type KeyEvent, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ACTION_CATALOG, actionsForDocument, type QueenAction } from "./functions/action/catalog";
import { BeeSplash } from "./components/bee-splash";
import { Card } from "./components/card";
import { Divider } from "./components/divider";
import { Stack } from "./components/stack";
import { ThinkingBlock } from "./components/thinking-block";
import { ToolCall } from "./components/tool-call";
import type { QueenDocument } from "./documents";
import { createDocumentChat, type ChatToolInfo, type DocumentChatSession } from "./functions/document-chat";
import { lastThink, stripThinking } from "./utils/stream-status";
import { useTheme } from "./theme/use-theme";
import { AppShell } from "./userinterface";

type SidebarMode = "actions" | "chat";
type Focus = "docs" | "actions" | "chat";

type ChatMessage = {
  id: number;
  role: "you" | "queen";
  text: string;
  thinking?: string;
  streaming?: boolean;
  tools?: ChatToolInfo[];
  promptTokens?: number;
  ttftMs?: number;
};

const DUMMY_ACTION_MS = 6000;

function pickPromptAction(prompt: string): QueenAction | undefined {
  const q = prompt.toLowerCase();
  const resource =
    q.match(/\b(todo|todos|task|tasks)\b/)?.[1] ? "todos" :
    q.match(/\b(fact|facts)\b/)?.[1] ? "facts" :
    q.match(/\b(conversation|conversations|transcript|said)\b/)?.[1] ? "conversations" :
    q.match(/\b(journal|journals|voice note|voice notes)\b/)?.[1] ? "journals" :
    q.match(/\b(daily|summary|summaries)\b/)?.[1] ? "daily" :
    q.match(/\b(insight|insights)\b/)?.[1] ? "insights" : undefined;
  if (!resource) return undefined;
  return ACTION_CATALOG.find((action) => action.resource === resource)
    ?? ACTION_CATALOG.find((action) => action.id.startsWith(resource));
}

export function Screen({
  docs,
  initialPrompt = "",
}: {
  docs: QueenDocument[];
  initialPrompt?: string;
}) {
  const theme = useTheme();
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [selectedKey, setSelectedKey] = useState(docs[0]?.key ?? "");
  const [mode, setMode] = useState<SidebarMode>("actions");
  const [focus, setFocus] = useState<Focus>("actions");
  const [used, setUsed] = useState<Set<string>>(() => new Set());
  const [splashWords, setSplashWords] = useState<string | null>(null);
  const [actionIndex, setActionIndex] = useState(0);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedPrompt = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatCancel = useRef(false);
  const chatId = useRef(1);
  const chatSession = useRef<DocumentChatSession | null>(null);
  const inputRef = useRef<TextareaRenderable | null>(null);

  const doc = docs.find((item) => item.key === selectedKey) ?? docs[0];
  const actions = useMemo(
    () => (doc ? actionsForDocument(doc.kind).filter((action) => !used.has(`${doc.key}:${action.id}`)) : []),
    [doc, used],
  );
  const selectedAction = actions[actionIndex] ?? actions[0];

  const syntaxStyle = useMemo(
    () =>
      SyntaxStyle.fromTheme([
        { scope: ["markup.heading"], style: { foreground: theme.colors.primary, bold: true } },
        { scope: ["markup.strong"], style: { foreground: theme.colors.foreground, bold: true } },
        { scope: ["markup.italic"], style: { foreground: theme.colors.foreground, italic: true } },
        { scope: ["markup.raw"], style: { foreground: theme.colors.accent } },
        { scope: ["markup.raw.block"], style: { foreground: theme.colors.accent } },
        { scope: ["markup.link"], style: { foreground: theme.colors.info, underline: true } },
        { scope: ["markup.link.label"], style: { foreground: theme.colors.info, underline: true } },
        { scope: ["markup.link.url"], style: { foreground: theme.colors.mutedForeground } },
        { scope: ["markup.list"], style: { foreground: theme.colors.mutedForeground } },
        { scope: ["markup.quote"], style: { foreground: theme.colors.mutedForeground, italic: true } },
        { scope: ["markup.strikethrough"], style: { dim: true } },
      ]),
    [theme],
  );

  const setSplash = (words: string | null) => {
    setSplashWords(words);
  };

  const clearSplash = () => {
    if (splashTimer.current) {
      clearTimeout(splashTimer.current);
      splashTimer.current = null;
    }
    setSplash(null);
  };

  const runDummyAction = (action: QueenAction) => {
    if (!doc) return;
    clearSplash();
    setSplash(`running ${action.label}…`);
    splashTimer.current = setTimeout(() => {
      splashTimer.current = null;
      setUsed((prev) => new Set(prev).add(`${doc.key}:${action.id}`));
      setSplash(null);
    }, DUMMY_ACTION_MS);
  };

  useEffect(() => {
    return () => {
      if (splashTimer.current) clearTimeout(splashTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedKey && docs[0]) setSelectedKey(docs[0].key);
  }, [docs, selectedKey]);

  useEffect(() => {
    setActionIndex(0);
  }, [doc?.key]);

  
  useEffect(() => {
    if (startedPrompt.current || !initialPrompt.trim() || !doc) return;
    startedPrompt.current = true;
    const action = pickPromptAction(initialPrompt);
    if (action) runDummyAction(action);
  }, [doc, initialPrompt]);

  const updateMessage = (id: number, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  };

  const upsertTool = (messageId: number, info: ChatToolInfo) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        const tools = [...(message.tools ?? [])];
        const index = tools.findIndex((item) => item.id === info.id);
        if (index >= 0) tools[index] = info;
        else tools.push(info);
        return { ...message, tools };
      }),
    );
  };

  const ask = async () => {
    const question = (inputRef.current?.editBuffer.getText() ?? input).trim();
    if (!question || !doc || chatBusy) return;
    inputRef.current?.editBuffer.setText("");
    setInput("");

    const userId = chatId.current++;
    const answerId = chatId.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "you", text: question },
      { id: answerId, role: "queen", text: "", thinking: "", streaming: true, tools: [] },
    ]);
    setChatBusy(true);
    chatCancel.current = false;

    let session = chatSession.current;
    if (session === null || session.key !== doc.key) {
      session = createDocumentChat(doc);
      chatSession.current = session;
    }

    let finalRaw = "";
    try {
      await session.send(question, {
        onText: (raw) => {
          finalRaw = raw;
          updateMessage(answerId, { thinking: lastThink(raw) ?? "", text: stripThinking(raw) });
        },
        onTool: (event) => upsertTool(answerId, event.info),
        onMeta: (meta) => updateMessage(answerId, { promptTokens: meta.promptTokens, ttftMs: meta.ttftMs }),
        isCancelled: () => chatCancel.current,
      });
      updateMessage(answerId, {
        thinking: lastThink(finalRaw) ?? "",
        text: stripThinking(finalRaw).trim() || "(no response)",
        streaming: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateMessage(answerId, { text: `error: ${message}`, streaming: false });
    } finally {
      setChatBusy(false);
    }
  };

  const quit = () => {
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      quit();
      return;
    }
    if (key.ctrl && key.name === "d") {
      key.preventDefault();
      setMode((current) => {
        const next = current === "actions" ? "chat" : "actions";
        setFocus(next === "chat" ? "chat" : "actions");
        return next;
      });
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setFocus((current) => {
        if (current === "docs") return mode === "chat" ? "chat" : "actions";
        return "docs";
      });
      return;
    }
    if (key.name === "escape") {
      if (chatBusy) {
        key.preventDefault();
        chatCancel.current = true;
        return;
      }
      if (splashWords) {
        key.preventDefault();
        clearSplash();
        return;
      }
      if (mode === "chat") {
        key.preventDefault();
        setFocus("actions");
        return;
      }
    }
  });

  if (splashWords !== null) {
    return <BeeSplash words={splashWords} hint="esc to cancel" onCancel={clearSplash} />;
  }

  if (!doc) {
    return (
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <text fg={theme.colors.mutedForeground}>No document selected.</text>
      </box>
    );
  }

  const sidebarW = Math.max(28, Math.min(46, Math.floor(width * 0.32)));
  const actionSubtitle = selectedAction?.subtitle ?? "no actions left for this document";
  const documentContent = doc.markdown;

  return (
    <AppShell>
      <box width="100%" height="100%" flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
      <box flexGrow={1} minWidth={0} flexDirection="column">
        <Card title={doc.title} subtitle={doc.subtitle} height="100%">
          <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="top" scrollbarOptions={{ showArrows: false }}>
            <markdown
              content={documentContent}
              syntaxStyle={syntaxStyle}
              streaming={false}
              tableOptions={{ widthMode: "full", style: "grid" }}
            />
          </scrollbox>
        </Card>
      </box>

      <box width={sidebarW} flexShrink={0} flexDirection="column">
        <Stack gap={1} width="100%" height="100%">
          <Card title="documents" subtitle={`${docs.length} recent`} height="50%">
            <select
              focused={focus === "docs"}
              flexGrow={1}
              options={docs.map((item) => ({
                name: item.title,
                description: item.subtitle,
                value: item.key,
              }))}
              showDescription
              showSelectionIndicator
              onSelect={(_index, option) => {
                if (option?.value) setSelectedKey(String(option.value));
              }}
            />
          </Card>

          <Card
            title={mode === "actions" ? "actions" : "chat"}
            subtitle={mode === "actions" ? actionSubtitle : `Ask About · ${doc.subtitle}`}
            height="50%"
          >
            {mode === "actions" ? (
              <select
                focused={focus === "actions"}
                flexGrow={1}
                options={actions.map((action) => ({
                  name: action.label,
                  description: action.subtitle,
                  value: action.id,
                }))}
                showDescription
                showSelectionIndicator
                onChange={(index) => setActionIndex(index)}
                onSelect={(_index, option) => {
                  const action = actions.find((item) => item.id === option?.value);
                  if (action) runDummyAction(action);
                }}
              />
            ) : (
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" scrollbarOptions={{ showArrows: false }}>
                  {messages.length === 0 ? (
                    <text fg={theme.colors.mutedForeground}>
                      Ask anything about this document. Queen can only see this document and the current time.
                    </text>
                  ) : (
                    messages.map((message) => (
                      <box key={message.id} flexDirection="column" marginBottom={1}>
                        <text fg={message.role === "you" ? theme.colors.accent : theme.colors.primary}>
                          <b>{message.role === "you" ? "you" : "queen"}</b>
                        </text>
                        {message.role === "queen" && (message.streaming === true || (message.thinking ?? "").length > 0) && (
                          <box marginBottom={1}>
                            <ThinkingBlock
                              content={message.thinking ?? ""}
                              streaming={message.streaming === true}
                              {...(message.promptTokens !== undefined ? { tokenCount: message.promptTokens } : {})}
                              {...(message.ttftMs !== undefined ? { duration: message.ttftMs } : {})}
                            />
                          </box>
                        )}
                        {message.role === "queen" &&
                          message.tools?.map((item) => (
                            <box key={item.id} marginBottom={1}>
                              <ToolCall
                                name={item.name}
                                args={item.args}
                                status={item.status}
                                result={item.result ?? item.error}
                                duration={item.durationMs}
                                focus={false}
                              />
                            </box>
                          ))}
                        {message.text.length > 0 && <text fg={theme.colors.foreground}>{message.text}</text>}
                      </box>
                    ))
                  )}
                </scrollbox>
                <Divider />
                <textarea
                  ref={inputRef}
                  focused={focus === "chat"}
                  placeholder="ask a question…"
                  height={2}
                  minHeight={2}
                  keyBindings={[{ name: "return", action: "submit" }]}
                  onSubmit={() => void ask()}
                  onContentChange={() => setInput(inputRef.current?.editBuffer.getText() ?? "")}
                  textColor={theme.colors.foreground}
                  focusedTextColor={theme.colors.foreground}
                  backgroundColor="transparent"
                  focusedBackgroundColor="transparent"
                  placeholderColor={theme.colors.mutedForeground}
                  cursorColor={theme.colors.focusRing}
                  cursorStyle={{ style: "block", blinking: false }}
                />
              </box>
            )}
          </Card>
        </Stack>
      </box>
      </box>
    </AppShell>
  );
}
