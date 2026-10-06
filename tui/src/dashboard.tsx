import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { Columns } from "./components/columns";
import { Text } from "@opentui/core";
import { Banner } from "./components/banner";
import { useTheme } from "./theme/use-theme";
import { Alert } from "./components/alert";
import { Badge } from "./components/badge";
import { Stack } from "./components/stack";
import { Card } from "./components/card";
import { Spinner } from "./components/spinner";
import { TailLine } from "./components/one-line";
import { Autocomplete, type AutocompleteOption } from "./components/autocomplete";
import { COMMANDS } from "./interface/help-modal";

import { tableColumns, tableRows, initialAlert, type AlertSpec, type ChartSpec, type Row } from "./utils/dashboard-spec";
import { MultiProgress, type MultiProgressItem } from "./components/multi-progress";
import { modelParams, modelAvailable } from "./functions/model-params";
import { useChat } from "./libraries/chat-control";
import { LineChart } from "./interface/line-chart";
import { Sparkline } from "./interface/sparkline";
import { KeyValue } from "./components/key-value";
import { BarChart } from "./interface/bar-chart";
import { PieChart } from "./interface/pie-chart";
import { Divider } from "./components/divider";
import { Heatmap } from "./interface/heatmap";
import { Table } from "./components/table";
import { Gauge } from "./interface/gauge";

import { useDashboardSpec } from "./utils/use-dashboard-spec";
import { tailClip, lastThink, finalReply, replyUnprocessed } from "./utils/stream-status";
import { ChartPanel } from "./interface/chart-panel";
import { useUi } from "./userinterface";
import { useMcp } from "./mcproviders";
import { getToolAssignment } from "./functions/tools-execution";
import { QUEEN_VERSION } from "./app";

const AGENT_LABELS: Record<string, string> = {
  conversation: "conversations",
  facts: "facts",
  insights: "insights",
  journals: "journals",
  locations: "locations",
  todos: "todos",
  files: "files",
  external: "external",
};

// Command list for the "/" autocomplete: bare name + the reference description.
const AC_OPTIONS: AutocompleteOption[] = COMMANDS.map(([label, description]) => {
  const bare = label.replace(/^\//, "");
  const name = (bare.match(/^[a-z0-9]+/i)?.[0] ?? "").toLowerCase();
  return { name, label: bare.split(/[\s,]+/)[0] ?? bare, description };
}).filter((option) => option.name.length > 0);

export function Dashboard() {
  const { width, height } = useTerminalDimensions();
  const theme = useTheme();
  const ui = useUi();
  const mcp = useMcp();
  const assignment = mcp.status === "connected" ? getToolAssignment() : { assigned: 0, unassigned: 0 };
  const chat = useChat();
  // TODO: pass setSpec into useChat and register createDashboardTool to make this agent-driven.
  const { spec } = useDashboardSpec();
  const inputRef = useRef<TextareaRenderable | null>(null);
  const inputActive = chat.ready && !chat.busy && !ui.modalOpen;

  // MARK: - "/" command autocomplete
  const [inputText, setInputText] = useState("");
  const [acSelected, setAcSelected] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const acQuery = /^\/(\S*)$/.exec(inputText)?.[1] ?? null;
  const acMatches = useMemo(() => {
    if (acQuery === null) return [];
    const q = acQuery.toLowerCase();
    return AC_OPTIONS.filter((option) => option.name.startsWith(q));
  }, [acQuery]);
  const acOpen = inputActive && !acDismissed && acQuery !== null && acMatches.length > 0;
  useEffect(() => {
    setAcSelected(0);
  }, [acQuery]);

  const applyChoice = (option: AutocompleteOption) => {
    const text = `/${option.name} `;
    const buffer = inputRef.current?.editBuffer;
    if (buffer) {
      buffer.setText(text);
      buffer.setCursorByOffset(text.length);
    }
    setInputText(text);
  };

  const handleAutocompleteKey = (key: KeyEvent) => {
    if (!acOpen) return;
    const count = acMatches.length;
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      setAcSelected((current) =>
        key.name === "up" ? (current - 1 + count) % count : (current + 1) % count,
      );
      return;
    }
    if (key.name === "tab" || key.name === "return") {
      const option = acMatches[acSelected] ?? acMatches[0];
      if (option) {
        key.preventDefault();
        applyChoice(option);
      }
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      setAcDismissed(true);
    }
  };

  const submitInput = () => {
    if (acOpen) {
      const option = acMatches[acSelected] ?? acMatches[0];
      if (option) {
        applyChoice(option);
        return;
      }
    }
    const text = inputRef.current?.editBuffer.getText() ?? "";
    if (!text.trim()) return;
    void chat.send(text);
    inputRef.current?.editBuffer.setText("");
    setInputText("");
  };

  const chartCount = Math.max(1, spec.charts.length);
  const innerW = Math.max(40, width - 2);
  const chartH = Math.min(10, Math.max(6, Math.floor(height * 0.24)));
  const chartColW = Math.floor((innerW - (chartCount - 1)) / chartCount);
  const chartContentW = Math.max(12, chartColW - 4);
  const chartContentH = Math.max(4, chartH - 2); // inside the panel border
  const gaugeSize = chartContentW < 18 ? "sm" : "md";
  const lineHeight = Math.max(3, chartContentH - 2); // grid rows (axis + labels take 2)
  const pieRadius = Math.max(2, Math.min(5, Math.floor((chartContentW - 20) / 4), Math.floor(chartContentH / 2)));

  const colGap = 1;
  const colW = Math.floor((innerW - colGap) / 2);
  const tableInnerW = Math.max(20, colW - 4);

  const sessionCols = tableColumns(spec.table);
  const sessionRows = tableRows(spec.table);
  const hasStats = (spec.table.stats?.length ?? 0) > 0;

  const detailCols = tableColumns(spec.details);
  const detailRows = tableRows(spec.details);

  // TODO Live context bars: spec defines bars (id/label/total/status); dashboard overlays live values by matching item.id ("tokens" / active agent).
  const contextLimit = modelParams().contextWindow;
  const contextItems: MultiProgressItem[] = spec.context.items.map((item) => {
    if (item.id === "tokens") {
      return {
        ...item,
        value: chat.context.used,
        status: chat.busy && !chat.context.active ? "running" : item.status,
      };
    }
    if (chat.context.active && item.id === chat.context.active) {
      return { ...item, value: chat.context.activeUsed, status: "running" };
    }
    return item;
  });
  // Keep today's behavior: show an ad-hoc bar for an active specialist with no bar
  if (chat.context.active && !contextItems.some((item) => item.id === chat.context.active)) {
    contextItems.push({
      id: chat.context.active,
      label: chat.context.active,
      value: chat.context.activeUsed,
      total: contextLimit,
      status: "running",
    });
  }
  
  const contextColW = Math.floor((innerW - colGap) / 3);
  const contextBarWidth = Math.max(3, contextColW - 34);

  const streamMsg = chat.streamingId != null ? chat.msgs.find((m) => m.id === chat.streamingId) : undefined;

  // Final-reply alert: after each turn show the model's answer plus the prompt
  // that produced it. The in-flight message is excluded so it commits at turn end.
  const reply = [...chat.msgs]
    .reverse()
    .find((m) => (m.role === "queen" || m.role === "error") && m.id !== chat.streamingId);
  const replyIdx = reply ? chat.msgs.findIndex((m) => m.id === reply.id) : -1;
  const prompt =
    replyIdx > 0
      ? [...chat.msgs.slice(0, replyIdx)].reverse().find((m) => m.role === "user")
      : undefined;
  const replyLineW = Math.max(8, innerW - 4); // alert border (2) + paddingX (2)
  const replyText = reply ? finalReply(reply.text) : "";
  const unprocessed = reply ? reply.role === "error" || replyUnprocessed(replyText) : false;
  // While a specialist subagent is live (or just finished, before the orchestrator
  // starts writing its final reply), its result owns the alert so the work is visible.
  const specialistResult =
    chat.specialist.visible && chat.specialist.text.trim().length > 0
      ? finalReply(chat.specialist.text)
      : "";
  const alertSpec: AlertSpec = specialistResult
    ? {
        variant: "info",
        title: `${chat.specialist.name ?? "subagent"} · subagent`,
        message: tailClip(specialistResult, replyLineW),
        appendix: "",
      }
    : reply
      ? {
          variant: unprocessed ? "error" : "success",
          title: unprocessed ? "Unprocessed" : "Processed",
          message: tailClip(replyText, replyLineW),
          appendix: tailClip(prompt?.text ?? "", replyLineW),
        }
      : initialAlert(spec.alert, chat.loggedIn);

  // Auto-open the markdown answer viewer when the final answer needs more than
  // 1.5 alert lines. Keyed on answerSeq so each new answer opens at most once.
  const openedSeqRef = useRef(-1);
  useEffect(() => {
    if (chat.answerSeq === openedSeqRef.current) return;
    openedSeqRef.current = chat.answerSeq;
    const answer = chat.finalAnswer.trim();
    const view = chat.answerView;
    // Structured answers (tables / search results) always open; prose only when long.
    if (view) {
      ui.openAnswer(view);
    } else if (answer && answer.length > Math.floor(1.5 * replyLineW)) {
      ui.openAnswer({ title: "queen · answer", markdown: answer });
    }
  }, [chat.answerSeq, chat.answerView, chat.finalAnswer, replyLineW, ui]);

  const detailsW = innerW - colGap - contextColW;
  let statusTitle: string;
  let statusMessage: string;
  let statusVariant: "info" | "neutral" | "success" = "info";
  let statusIcon: ReactNode | undefined;
  switch (chat.phase.kind) {
    case "thinking":
      statusTitle = "Thinking";
      statusMessage = lastThink(streamMsg?.text ?? "") ?? ""; // only thinking, never final output
      statusVariant = "neutral";
      statusIcon = <Spinner type="dots" color={theme.colors.foreground} />;
      break;
    case "tool": {
      statusTitle = "Tool call";
      const lastTool = streamMsg?.tools?.[streamMsg.tools.length - 1];
      if (chat.context.active) {
        // Show the specialist plus the sub-tool it is currently calling.
        statusMessage = chat.specialist.tool
          ? `${chat.context.active} · ${chat.specialist.tool}`
          : chat.context.active;
      } else {
        statusMessage = lastTool?.result ? String(lastTool.result) : chat.phase.tool;
      }
      statusIcon = <Spinner type="earth" />;
      break;
    }
    case "working":
      statusTitle = chat.phase.label;
      statusMessage = chat.phase.detail;
      statusVariant = "neutral";
      statusIcon = <Spinner type="dots" color={theme.colors.foreground} />;
      break;
    case "done":
      statusTitle = "Done";
      statusMessage = "Just a queen doing queen things 💅";
      statusVariant = "success";
      break;
    default:
      statusTitle = "Idle";
      statusMessage = "Queen is just chilling 😴";
  }
  const statusText = tailClip(statusMessage, Math.max(4, detailsW - 4 - statusTitle.length - 6));
  const routingText = `Routing to Bee ${AGENT_LABELS[chat.context.active ?? ""] ?? chat.context.active ?? ""} subagent to process your query`;
  // Second line: the specialist's live thinking (falls back to the routing copy).
  // Rendered via TailLine, so it is always a single tail-clipped row.
  const specialistThinking = (chat.context.active ? lastThink(chat.specialist.text) : null) ?? routingText;

  const inputRows = 1;
  const inputH = inputRows + 2; // text-area border
  const contextRows = chat.context.active ? 2 : 1; // queen (+ active specialist)
  const contextRowH = contextRows + 2; // content + top/bottom border (title is in the border)
  const stack2H = contextRowH + 1 + 4; // + gap + offline alert
  const stack3H = Math.max(6, height - (1 + chartH + stack2H + 3));
  const bodyH = Math.max(4, stack3H - inputH - 1); // columns share what's left of the input row
  const cardChrome = 4; // border (2) + title block (2)
  const tableChrome = 4;
  const statsH = hasStats && bodyH - cardChrome - tableChrome >= 3 ? 3 : 0;
  const rowsFit = Math.max(1, bodyH - cardChrome - statsH - tableChrome);
  const tableMaxRows = sessionRows.length > rowsFit ? Math.max(1, rowsFit - 1) : sessionRows.length;
  const detailsMaxRows = detailRows.length > rowsFit ? Math.max(1, rowsFit - 1) : detailRows.length;

  const renderChart = (panel: ChartSpec) => {
    switch (panel.type) {
      case "bar":
        return <BarChart data={panel.data} width={chartContentW} />;
      case "sparkline":
        return (
          <Sparkline
            data={panel.data}
            width={chartContentW}
            height={Math.max(3, chartContentH - 1)}
            color={panel.color}
            variant={panel.variant}
            markerIndex={panel.markerIndex}
            label={panel.label}
          />
        );
      case "gauge":
        return <Gauge value={panel.value} size={gaugeSize} label={panel.label} min={panel.min} max={panel.max} />;
      case "line":
        return <LineChart data={panel.data} width={chartContentW} height={lineHeight} />;
      case "pie":
        return <PieChart data={panel.data} radius={pieRadius} />;
      case "heatmap":
        return <Heatmap data={panel.data} rowLabels={panel.rowLabels} />;
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
      <Stack gap={1} width="100%" height="100%">
        {/* header */}
        <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
          <box flexDirection="row" gap={1}>
            <text fg={theme.colors.primary}>
              <b>queen</b>
            </text>
            <Badge variant="info" bordered={false}>
              dashboard
            </Badge>
            <text fg={theme.colors.mutedForeground}>· dummy data</text>
          </box>
          <box flexDirection="row" gap={1}>
            {mcp.status === "connected" ? (
              <box flexDirection="row" gap={1}>
                <text fg={theme.colors.success}>
                  {`● mcp tools · ${assignment.assigned} assigned`}
                </text>
                {assignment.unassigned && 
                <text fg={theme.colors.warning}>
                  {`· ${assignment.unassigned} unassigned`}
                </text>}
              </box>
              
            ) : mcp.status === "error" ? (
              <text fg={theme.colors.error}>✕ mcp</text>
            ) : (
              <box flexDirection="row" gap={1}>
                <Spinner type="dots" />
                <text fg={theme.colors.mutedForeground}>mcp</text>
              </box>
            )}
            <text fg={theme.colors.mutedForeground}>{`· ${QUEEN_VERSION}`}</text>
          </box>
        </box>

        <box flexDirection="row" gap={1} height={chartH} flexShrink={0}>
          {spec.charts.map((panel, i) => (
            <ChartPanel key={`${panel.type}-${panel.title}-${i}`} title={panel.title} height={chartH}>
              {renderChart(panel)}
            </ChartPanel>
          ))}
        </box>

        <Stack gap={1} flexShrink={0}>
          <Columns gap={colGap} height={contextRowH} weights={[2, 1]}>
            <box
              flexDirection="column"
              borderStyle="rounded"
              borderColor={theme.colors.border}
              title="status"
              titleColor={theme.colors.mutedForeground}
              paddingLeft={1}
              paddingRight={1}
            >
              <box flexShrink={0}>
                <Banner variant={statusVariant} title={statusTitle} icon={statusIcon}>{statusText}</Banner>
              </box>
              {chat.context.active && (
                <TailLine text={specialistThinking} width={Math.max(4, detailsW - 4)} fg={theme.colors.mutedForeground} />
              )}
            </box>
            <box
              flexDirection="column"
              borderStyle="rounded"
              borderColor={theme.colors.border}
              title="context"
              titleColor={theme.colors.mutedForeground}
              paddingLeft={1}
              paddingRight={1}
            >
              <MultiProgress
                items={contextItems}
                labelWidth={8}
                barWidth={contextBarWidth}
                compact
              />
            </box>
          </Columns>
          <Alert
            variant={alertSpec.variant}
            title={alertSpec.title}
            message={alertSpec.message}
            appendix={alertSpec.appendix}
          />
        </Stack>

        {/* details + sessions, with a full-width input beneath */}
        <Stack gap={1} flexGrow={1} minHeight={0}>
          <Columns gap={colGap} flexGrow={1} minHeight={0}>
            <Card title={spec.details.title} height="100%">
              <Table<Row>
                data={detailRows}
                columns={detailCols}
                totalWidth={tableInnerW}
                maxRows={detailsMaxRows}
              />
            </Card>
            <Card title={spec.table.title} height="100%">
              <Table<Row>
                data={sessionRows}
                columns={sessionCols}
                totalWidth={tableInnerW}
                maxRows={tableMaxRows}
              />
              {hasStats && (
                <>
                  <Divider label="stats" />
                  <KeyValue items={spec.table.stats ?? []} />
                </>
              )}
            </Card>
          </Columns>
          {acOpen && <Autocomplete options={acMatches} selected={acSelected} />}
          <box
            flexShrink={0}
            borderStyle="rounded"
            borderColor={inputActive ? theme.colors.focusRing : theme.colors.border}
            paddingLeft={1}
            paddingRight={1}
          >
            <textarea
              ref={inputRef}
              focused={inputActive}
              placeholder={modelAvailable() ? "ask a question or write /commands to change data" : "queen-lite: write /commands (no model) — try /help"}
              height={inputRows}
              minHeight={inputRows}
              keyBindings={acOpen ? [] : [{ name: "return", action: "submit" }]}
              onSubmit={submitInput}
              onKeyDown={handleAutocompleteKey}
              onContentChange={() => {
                setInputText(inputRef.current?.editBuffer.getText() ?? "");
                setAcDismissed(false);
              }}
              textColor={theme.colors.foreground}
              focusedTextColor={theme.colors.foreground}
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
              placeholderColor={theme.colors.mutedForeground}
              cursorColor={theme.colors.focusRing}
              cursorStyle={{ style: "block", blinking: false }}
            />
          </box>
        </Stack>
      </Stack>
    </box>
  );
}
