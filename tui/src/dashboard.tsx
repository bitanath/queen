import { useRef } from "react";
import type { ReactNode } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "./theme/use-theme";
import { Alert } from "./components/alert";
import { Badge } from "./components/badge";
import { Card } from "./components/card";
import { Columns } from "./components/columns";
import { Stack } from "./components/stack";

import { Chat, useChat } from "./chat";
import { Gauge } from "./interfaces/gauge";
import { Banner } from "./components/banner";
import { Divider } from "./components/divider";
import { BarChart } from "./interfaces/bar-chart";
import { LineChart } from "./interfaces/line-chart";
import { PieChart } from "./interfaces/pie-chart";
import { Heatmap } from "./interfaces/heatmap";
import { KeyValue } from "./components/key-value";
import { Sparkline } from "./interfaces/sparkline";
import { Table } from "./components/table";
import { QUEEN_VERSION } from "./app";
import { useUi } from "./userinterface";
import { tableColumns, tableRows, type ChartSpec, type Row } from "./utils/dashboard-spec";
import { useDashboardSpec } from "./utils/use-dashboard-spec";

const ChartPanel = ({ title, width, height, children}: { title: string; width?: number; height: number; children: ReactNode;}) => {
  const theme = useTheme();
  return (
    <box
      flexGrow={1}
      width={width}
      height={height}
      borderStyle="rounded"
      borderColor={theme.colors.border}
      title={title}
      titleColor={theme.colors.mutedForeground}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <box
        flexGrow={1}
        width="100%"
        minHeight={0}
        overflow="hidden"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
      >
        {children}
      </box>
    </box>
  );
};

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

  // Chat + sessions are equal-width columns.
  const colGap = 1;
  const colW = Math.floor((innerW - colGap) / 2);
  const tableInnerW = Math.max(20, colW - 4);

  const sessionCols = tableColumns(spec.sessions);
  const sessionRows = tableRows(spec.sessions);
  const hasStats = (spec.sessions.stats?.length ?? 0) > 0;

  const inputRows = 1;
  const inputH = inputRows + 2; // text-area border
  const stack2H = 7; // alert (4) + gap (1) + banner (2)
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
        return <Sparkline data={panel.data} width={chartContentW} label={panel.label} />;
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
          <Alert variant="warning" title="context window">
            12,480 / 32k tokens (39%) — older turns will be trimmed.
          </Alert>
          <Banner variant="info" title="offline fallback">
            Bee unreachable — answering with the local model.
          </Banner>
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
