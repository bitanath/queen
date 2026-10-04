import { useRef } from "react";

import type { TextareaRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { Columns } from "./components/columns";
import { Banner } from "./components/banner";
import { useTheme } from "./theme/use-theme";
import { Alert } from "./components/alert";
import { Badge } from "./components/badge";
import { Stack } from "./components/stack";
import { Card } from "./components/card";

import { tableColumns, tableRows, type ChartSpec, type Row } from "./utils/dashboard-spec";
import { MultiProgress, type MultiProgressItem } from "./components/multi-progress";
import { modelParams } from "./functions/model-params";
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
import { ChartPanel } from "./interface/chart-panel";
import { useUi } from "./userinterface";
import { QUEEN_VERSION } from "./app";
import { Chat } from "./chat";

export function Dashboard() {
  const { width, height } = useTerminalDimensions();
  const theme = useTheme();
  const ui = useUi();
  const chat = useChat();
  const { spec } = useDashboardSpec();
  const inputRef = useRef<TextareaRenderable | null>(null);
  const inputActive = !chat.busy && !ui.modalOpen;

  const submitInput = () => {
    const text = inputRef.current?.editBuffer.getText() ?? "";
    if (!text.trim()) return;
    void chat.send(text);
    inputRef.current?.editBuffer.setText("");
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

  const sessionCols = tableColumns(spec.sessions);
  const sessionRows = tableRows(spec.sessions);
  const hasStats = (spec.sessions.stats?.length ?? 0) > 0;

  const contextLimit = modelParams().contextWindow;
  const contextItems: MultiProgressItem[] = [
    {
      id: "tokens",
      label: "tokens",
      value: chat.context.used,
      total: contextLimit,
      status: chat.busy && !chat.context.active ? "running" : "done",
    },
  ];
  if (chat.context.active) {
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
          <text fg={theme.colors.mutedForeground}>{QUEEN_VERSION}</text>
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
              title="details"
              titleColor={theme.colors.mutedForeground}
              paddingLeft={1}
              paddingRight={1}
            >
              <Banner variant="info">Items: (some dummy here)</Banner>
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
          <Alert variant="warning" title="Bee Offline">
            Defaulting to local model.
          </Alert>
        </Stack>

        {/* chat + sessions, with a full-width input beneath */}
        <Stack gap={1} flexGrow={1} minHeight={0}>
          <Columns gap={colGap} flexGrow={1} minHeight={0}>
            <Card title="chat" height="100%">
              <Chat msgs={chat.msgs} streamingId={chat.streamingId} busy={chat.busy} />
            </Card>
            <Card title={spec.sessions.title} height="100%">
              <Table<Row>
                data={sessionRows}
                columns={sessionCols}
                totalWidth={tableInnerW}
                maxRows={tableMaxRows}
              />
              {hasStats && (
                <>
                  <Divider label="stats" />
                  <KeyValue items={spec.sessions.stats ?? []} />
                </>
              )}
            </Card>
          </Columns>
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
              placeholder="ask a question or write /commands to change data"
              height={inputRows}
              minHeight={inputRows}
              keyBindings={[{ name: "return", action: "submit" }]}
              onSubmit={submitInput}
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
