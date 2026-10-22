/* @jsxImportSource @opentui/react */
import { SyntaxStyle, TextAttributes, type KeyEvent, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ACTION_CATALOG, actionsForDocument, type QueenAction } from "./functions/action/catalog";
import { executeAction } from "./functions/action/execute";
import { BeeSplash } from "./components/bee-splash";
import { Card } from "./components/card";
import { Divider } from "./components/divider";
import { FactorBars } from "./components/factor-bars";
import { Markdown } from "./components/markdown";
import { matrixLayout, Matrix } from "./components/matrix";
import { Modal } from "./components/modal";
import { Stack } from "./components/stack";
import { ThinkingBlock } from "./components/thinking-block";
import { ToolCall } from "./components/tool-call";
import { fetchConversation, topicMeta, type QueenDocument } from "./documents";
import { factorMatrix } from "./functions/analytics/factor-view";
import { getTopicAnalytics } from "./functions/analytics/store";
import { useAnalytics } from "./functions/analytics/use-analytics";
import { createChatSession, type ChatToolInfo, type ChatSession } from "./functions/chat";
import type { UiBridge } from "./functions/ui-bridge";
import { LoginCard } from "./interface/login-card";
import { useToast } from "./interface/toaster";
import { labelsAreInferred, speakerLabels } from "./utils/diarize-speaker";
import { lastThink, stripThinking } from "./utils/stream-status";
import { useTheme } from "./theme/use-theme";
import { useUi } from "./userinterface";

type SidebarMode = "actions" | "chat";
type Focus = "docs" | "actions" | "chat" | "center";

type ChatMessage = {
  id: number;
  role: "you" | "queen";
  text: string;
  thinking?: string;
  status?: string;
  streaming?: boolean;
  tools?: ChatToolInfo[];
  promptTokens?: number;
  ttftMs?: number;
};

function statusLabel(status: { phase: string; agent?: string; family?: string }): string {
  if (status.phase === "ask") return "ask";
  if (status.phase === "orchestrator") return "orchestrator";
  if (status.phase === "select") return `${status.agent ?? "agent"} · ${status.family ?? "tools"}`;
  if (status.phase === "agent") return status.agent ?? "agent";
  if (status.phase === "approval") return `approval · ${status.family ?? status.agent ?? "tool"}`;
  return "";
}

const TRANSCRIPT_SPINNER = ["◐", "◓", "◑", "◒"]; //FIXME This is one way to do it

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
  onDocumentUpdate,
  onRefresh,
}: {
  docs: QueenDocument[];
  initialPrompt?: string;
  onDocumentUpdate?: (doc: QueenDocument) => void;
  onRefresh?: () => Promise<QueenDocument[]>;
}) {
  const theme = useTheme();
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [selectedKey, setSelectedKey] = useState(docs[0]?.key ?? "");
  const [mode, setMode] = useState<SidebarMode>("actions");
  const [focus, setFocus] = useState<Focus>("actions");
  const [splashWords, setSplashWords] = useState<string | null>(null);
  const [actionIndex, setActionIndex] = useState(0);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedPrompt = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatCancel = useRef(false);
  const chatId = useRef(1);
  const chatSession = useRef<ChatSession | null>(null);
  const inputRef = useRef<TextareaRenderable | null>(null);

  const doc = docs.find((item) => item.key === selectedKey) ?? docs[0];
  const actions = doc ? actionsForDocument(doc.kind) : [];

  const [transcriptLoadingKey, setTranscriptLoadingKey] = useState<string | null>(null);
  const transcriptPending = useRef<Set<string>>(new Set());
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!doc || doc.kind !== "conversation") return;
    if (doc.transcriptLines.length > 0) return;
    if (transcriptPending.current.has(doc.key)) return;
    transcriptPending.current.add(doc.key);
    let alive = true;
    setTranscriptLoadingKey(doc.key);
    fetchConversation(doc.id)
      .then((full) => {
        if (!alive) return;
        onDocumentUpdate?.({
          ...doc,
          transcript: full.transcript,
          transcriptLines: full.transcriptLines,
          markdown: full.markdown,
        });
      })
      .catch(() => {})
      .finally(() => {
        transcriptPending.current.delete(doc.key);
        if (alive) setTranscriptLoadingKey((key) => (key === doc.key ? null : key));
      });
    return () => {
      alive = false;
    };
  }, [doc?.key, doc?.kind, doc?.transcriptLines.length, onDocumentUpdate]);

  useEffect(() => {
    if (transcriptLoadingKey === null) return;
    const id = setInterval(() => setSpinnerFrame((f) => f + 1), 120);
    return () => clearInterval(id);
  }, [transcriptLoadingKey]);

  const syntaxStyle = useMemo(
    () =>
      SyntaxStyle.fromTheme([
        { scope: ["markup.heading"], style: { foreground: theme.colors.primary, bold: true } },
        { scope: ["markup.strong"], style: { foreground: theme.colors.primary, bold: true } },
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

  const transcriptLabels = useMemo(() => (doc ? speakerLabels(doc.transcriptLines) : []), [doc]);
  const transcriptInferred = useMemo(
    () => (doc ? labelsAreInferred(doc.transcriptLines) : false),
    [doc],
  );
  const speakerNames = useMemo(() => Array.from(new Set(transcriptLabels)), [transcriptLabels]);
  const speakerColor = (name: string) => {
    const keys = ["success", "warning", "info"] as const;
    const index = speakerNames.indexOf(name);
    return theme.colors[keys[(index < 0 ? 0 : index) % keys.length]!];
  };

  
  const analytics = useAnalytics();
  const factorView = useMemo(() => {
    if (!doc) return null;
    if (doc.kind !== "daily" && doc.kind !== "fact" && doc.kind !== "insight") return null;
    const meta = doc.topic ? topicMeta(doc.topic) : null;
    const result = getTopicAnalytics(doc.topic ?? undefined);
    if (!result) return null;
    return factorMatrix(result, meta ? { topic: doc.topic, emoji: meta.emoji, label: meta.label } : {});
  }, [doc?.kind, doc?.topic, analytics.status]);

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

  const toast = useToast();
  const { openAnswer } = useUi();
  const [loginOpen, setLoginOpen] = useState(false);
  const [clarify, setClarify] = useState<{
    question: string;
    options: string[];
    resolve: (choice: string) => void;
  } | null>(null);

  const bridge = useMemo<UiBridge>(
    () => ({
      showDocuments: () => void onRefresh?.(),
      refreshDocuments: () => void onRefresh?.(),
      openAnswer: (view) => openAnswer(view),
      toast: (message, variant) => toast(message, variant ? { variant } : undefined),
      login: () => setLoginOpen(true),
      clarify: (question, options) => new Promise<string>((resolve) => setClarify({ question, options, resolve })),
    }),
    [onRefresh, openAnswer, toast],
  );

  const runAction = useCallback(
    async (action: QueenAction) => {
      if (!doc) return;
      if (action.resource === "login") {
        setLoginOpen(true);
        return;
      }

      const target =
        action.scope === "document" &&
        (action.docKinds.length === 0 || action.docKinds.includes(doc.kind))
          ? doc
          : undefined;
      if (action.scope === "document" && !target) {
        openAnswer({
          title: action.label,
          markdown: `Select a ${action.docKinds.join(" or ")} document to use this action.`,
        });
        return;
      }

      clearSplash();
      setSplash(`running ${action.label}…`);
      try {
        const outcome = await executeAction(action, target);
        if (outcome.refresh) void onRefresh?.();
        if (outcome.view) openAnswer(outcome.view);
        else if (outcome.markdown) openAnswer({ title: outcome.title, markdown: outcome.markdown });
        if (outcome.toast) toast(outcome.toast);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), { variant: "error" });
      } finally {
        splashTimer.current = null;
        setSplash(null);
      }
    },
    [doc, onRefresh, openAnswer, toast],
  );

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
    if (action) void runAction(action);
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
    if (session === null) {
      session = await createChatSession(bridge);
      chatSession.current = session;
    }

    let finalRaw = "";
    try {
      await session.send(question, {
        onAck: (ack) => updateMessage(answerId, { text: ack.trimStart(), status: "ask" }),
        onThinking: (thought) => updateMessage(answerId, { thinking: thought }),
        onStatus: (status) => updateMessage(answerId, { status: statusLabel(status) }),
        onText: (raw) => {
          finalRaw = raw;
          updateMessage(answerId, { thinking: lastThink(raw) ?? "", text: stripThinking(raw).trimStart(), status: "" });
        },
        onTool: (event) => upsertTool(answerId, event.info),
        onMeta: (meta) => updateMessage(answerId, { promptTokens: meta.promptTokens, ttftMs: meta.ttftMs }),
        isCancelled: () => chatCancel.current,
      });
      updateMessage(answerId, {
        thinking: lastThink(finalRaw) ?? "",
        text: stripThinking(finalRaw).trim() || "(no response)",
        status: "",
        streaming: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateMessage(answerId, { text: `error: ${message}`, status: "", streaming: false });
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
    if (key.ctrl && key.name === "t") {
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
      const order: Focus[] = ["docs", mode === "chat" ? "chat" : "actions", "center"];
      setFocus((current) => {
        const index = order.indexOf(current);
        return order[(index + 1) % order.length] ?? "docs";
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

  if (loginOpen) {
    return (
      <LoginCard
        onConnected={() => {
          setLoginOpen(false);
          void onRefresh?.();
        }}
        onCancel={() => setLoginOpen(false)}
      />
    );
  }

  if (!doc) {
    return (
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <text fg={theme.colors.mutedForeground}>No document selected.</text>
      </box>
    );
  }

  const sidebarW = Math.max(28, Math.min(46, Math.floor(width * 0.32)));
  const centreW = Math.max(40, width - sidebarW - 8);
  const factorLayout = factorView
    ? matrixLayout(factorView.rowLabels, factorView.colLabels, centreW)
    : null;

  return (
    <box width="100%" height="100%" flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
      <box flexGrow={1} minWidth={0} flexDirection="column">
        <Card
          title={doc.title}
          height="100%"
          {...(focus === "center" ? { borderColor: theme.colors.focusRing } : {})}
        >
          <scrollbox
            focused={focus === "center"}
            flexGrow={1}
            minHeight={0}
            stickyScroll
            stickyStart="top"
            scrollbarOptions={{ showArrows: false }}
          >
            <Markdown content={doc.body} syntaxStyle={syntaxStyle} />
            {transcriptLoadingKey === doc.key && (
              <box flexDirection="row" gap={1} marginTop={1}>
                <text fg={theme.colors.mutedForeground}>
                  {TRANSCRIPT_SPINNER[spinnerFrame % TRANSCRIPT_SPINNER.length] ?? "◐"}
                </text>
                <text fg={theme.colors.mutedForeground}>loading transcript…</text>
              </box>
            )}
            {doc.transcriptLines.length > 0 && (
              <box flexDirection="column" marginTop={1}>
                <text fg={theme.colors.primary}>
                  <b>Transcript</b>
                </text>
                {transcriptInferred && (
                  <text fg={theme.colors.mutedForeground}>
                    inferred speakers · heuristic, may be inaccurate
                  </text>
                )}
                <box flexDirection="column" marginTop={1}>
                  {doc.transcriptLines.map((line, index) => {
                    const name = transcriptLabels[index] ?? line.speaker;
                    return (
                      <text key={index} wrapMode="word">
                        <span fg={speakerColor(name)} attributes={TextAttributes.BOLD | TextAttributes.ITALIC}>
                          {name}
                        </span>
                        {line.time !== undefined && (
                          <span fg={theme.colors.mutedForeground}>{` ${line.time} · `}</span>
                        )}
                        <span fg={theme.colors.foreground}>{line.text}</span>
                      </text>
                    );
                  })}
                </box>
              </box>
            )}
            {factorView && (
              <box flexDirection="column" marginTop={1}>
                <Divider />
                <text fg={theme.colors.primary}>
                  <b>{factorView.title}</b>
                </text>
                {factorView.summary !== "" && (
                  <text fg={theme.colors.mutedForeground}>
                    <i>{factorView.summary}</i>
                  </text>
                )}
                <Matrix
                  rowLabels={factorView.rowLabels}
                  colLabels={factorView.colLabels}
                  data={factorView.data}
                  highlightCol={factorView.highlightCol}
                  totalWidth={centreW}
                  labelWidth={factorLayout?.lw}
                />
                {factorView.bars.length > 0 && (
                  <box flexDirection="column" marginTop={1}>
                    <text fg={theme.colors.mutedForeground}>variance explained (%)</text>
                    <FactorBars
                      rows={factorView.bars}
                      width={factorLayout?.width ?? centreW}
                      labelWidth={factorLayout?.lw}
                    />
                  </box>
                )}
                {factorView.glossary.length > 0 && (
                  <box flexDirection="column" marginTop={1}>
                    {factorView.glossary.map((g, i) => (
                      <text key={i} fg={theme.colors.mutedForeground}>
                        {`• ${g.label} — ${g.text}`}
                      </text>
                    ))}
                  </box>
                )}
              </box>
            )}
          </scrollbox>
        </Card>
      </box>

      <box width={sidebarW} flexShrink={0} flexDirection="column">
        <Stack gap={1} width="100%" height="100%">
          <Card title={`documents · ${docs.length} recent`} height="50%">
            <select
              focused={focus === "docs"}
              flexGrow={1}
              options={docs.map((item) => ({
                name: `${item.emoji} ${item.title}`,
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
            height="50%"
            footer={
              mode === "actions" ? (
                <text fg={theme.colors.mutedForeground}>Use ctrl+t to switch to a chat agent</text>
              ) : undefined
            }
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
                  if (action) void runAction(action);
                }}
              />
            ) : (
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" scrollbarOptions={{ showArrows: false }}>
                  {messages.length === 0 ? (
                    <box flexDirection="column" marginBottom={1}>
                      <text fg={theme.colors.primary}>
                        <b>queen</b>
                      </text>
                      <text fg={theme.colors.foreground} wrapMode="word">
                        Hi! I'm Queen 👑, a TUI frontend for 🐝. Ask me anything about this doc, and I'll endeavor to
                        help you while staying fabulous 💅
                      </text>
                    </box>
                  ) : (
                    messages.map((message) => (
                      <box key={message.id} flexDirection="column" marginBottom={1}>
                        <text fg={message.role === "you" ? theme.colors.accent : theme.colors.primary}>
                          <b>{message.role === "you" ? "you" : "queen"}</b>
                        </text>
                        {message.role === "queen" && message.status && (
                          <text fg={theme.colors.mutedForeground}>{message.status}</text>
                        )}
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
                        {message.text.length > 0 && (
                          <Markdown
                            content={message.text}
                            syntaxStyle={syntaxStyle}
                            streaming={message.streaming === true}
                          />
                        )}
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

      {clarify && (
        <Modal
          title="clarify"
          width={72}
          height={10}
          onClose={() => {
            clarify.resolve("");
            setClarify(null);
          }}
        >
          <box flexDirection="column" gap={1}>
            <text fg={theme.colors.foreground}>{clarify.question}</text>
            <select
              focused
              flexGrow={1}
              options={clarify.options.map((option) => ({ name: option, value: option, description: "" }))}
              onSelect={(_index, option) => {
                clarify.resolve(String(option?.value ?? ""));
                setClarify(null);
              }}
            />
          </box>
        </Modal>
      )}
      </box>
  );
}
