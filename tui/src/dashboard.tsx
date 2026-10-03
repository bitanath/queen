import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { useTheme } from "./theme/use-theme";
import { Alert } from "./components/alert";
import { Badge } from "./components/badge";
import { Card } from "./components/card";

import { Chat } from "./chat";
import { Gauge } from "./components/gauge";
import { Banner } from "./components/banner";
import { Divider } from "./components/divider";
import { BarChart } from "./components/bar-chart";
import { KeyValue } from "./components/key-value";
import { Sparkline } from "./components/sparkline";
import { Table, type Column } from "./components/table";
import { naturalWidths, parseMarkdownTable } from "./libraries/table-format";

import { REQUEST_BARS, SATURATION, TABLE_MD, TABLE_STATS, THROUGHPUT, } from "./utils/dummy";

type Row = Record<string, unknown>;

const parsed = parseMarkdownTable(TABLE_MD);
const tableColumns: Column<Row>[] = (parsed?.headers ?? []).map((header, i) => ({
  key: header,
  header,
  align: parsed?.aligns[i] ?? "left",
}));
const tableData: Row[] = (parsed?.rows ?? []).map((row) =>
  Object.fromEntries(
    (parsed?.headers ?? []).map((h, i) => [h, row[i] ?? ""]),
  ),
);

// TODO Width the table wants at its natural spacing: sum(cols) + 3n + 1 borders.
const tableNaturalW = parsed ? naturalWidths(parsed.headers, parsed.rows).reduce((a, b) => a + b, 0) + 3 * parsed.headers.length + 1 : 40;

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
      {children}
    </box>
  );
};

export function Dashboard() {
  const { width, height } = useTerminalDimensions();
  const theme = useTheme();

  const chartH = Math.min(10, Math.max(6, Math.floor(height * 0.24)));
  const innerW = Math.max(40, width - 2);
  const chartColW = Math.floor((innerW - 2) / 3);
  const chartContentW = Math.max(12, chartColW - 4);
  const gaugeSize = chartContentW < 18 ? "sm" : "md";

  const tableW = Math.max(
    34,
    Math.min(tableNaturalW + 4, Math.max(34, width - 34)),
  );
  const tableInnerW = tableW - 4;
  
  const stack2H = 7; // alert (4) + margin (1) + banner (2)
  const stack3H = Math.max(6, height - (1 + chartH + stack2H + 3));
  const cardChrome = 4; // border (2) + title block (2)
  const tableChrome = 4;
  const statsH = stack3H - cardChrome - tableChrome >= 3 ? 3 : 0;
  const rowsFit = Math.max(1, stack3H - cardChrome - statsH - tableChrome);
  const tableMaxRows = tableData.length > rowsFit ? Math.max(1, rowsFit - 1) : tableData.length;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      gap={1}
    >
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
        <text fg={theme.colors.mutedForeground}>{`${width}×${height} · prod`}</text>
      </box>

      <box flexDirection="row" gap={1} height={chartH} flexShrink={0}>
        <ChartPanel title="requests" height={chartH}>
          <BarChart data={REQUEST_BARS} width={chartContentW} />
        </ChartPanel>
        <ChartPanel title="throughput" height={chartH}>
          <Sparkline data={THROUGHPUT} width={chartContentW} />
        </ChartPanel>
        <ChartPanel title="saturation" height={chartH}>
          <Gauge value={SATURATION} size={gaugeSize} label="vram" />
        </ChartPanel>
      </box>

      <box flexDirection="column" flexShrink={0}>
        <Alert variant="warning" title="context window">
          12,480 / 32k tokens (39%) — older turns will be trimmed.
        </Alert>
        <box marginTop={1}>
          <Banner variant="info" title="offline fallback">
            Bee unreachable — answering with the local model.
          </Banner>
        </box>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minHeight={0} overflow="hidden">
        <box flexGrow={1} minHeight={0} overflow="hidden">
          <Chat />
        </box>
        <Card title="sessions" width={tableW} height="100%">
          <Table<Row>
            data={tableData}
            columns={tableColumns}
            totalWidth={tableInnerW}
            maxRows={tableMaxRows}
          />
          {statsH > 0 && (
            <>
              <Divider label="stats" />
              <KeyValue items={TABLE_STATS} />
            </>
          )}
        </Card>
      </box>
    </box>
  );
}
