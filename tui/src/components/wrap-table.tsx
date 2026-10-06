/* @jsxImportSource @opentui/react */
// Full-width table for the answer modal. Unlike the dashboard `Table`, cells
// wrap to the column width (rows grow taller) and values are color-coded
// (booleans / status enums). Width math is display-width aware.
import { Fragment } from "react";

import { useTheme } from "../theme/use-theme";
import {
  allocateWidths,
  displayWidth,
  padDisplay,
  truncateDisplay,
  wrapDisplay,
} from "../libraries/table-format";
import type { Column } from "./table";

type Row = Record<string, unknown>;

const CELL_NATURAL_CAP = 40;
const MIN_COL_WIDTH = 4;

type Theme = ReturnType<typeof useTheme>;

/** Value-based coloring: booleans and common status enums. */
function colorFor(value: string, theme: Theme): string | undefined {
  const v = value.trim().toLowerCase();
  if (v === "true") return theme.colors.success;
  if (v === "false") return theme.colors.warning;
  if (/^(completed|ready|done|ok|active|confirmed|success|connected)$/.test(v)) {
    return theme.colors.success;
  }
  if (/^(preparing|analyzing|pending|processing|in_progress|degraded|warn|warning)$/.test(v)) {
    return theme.colors.warning;
  }
  if (/^(failed|error|cancelled|canceled|blocked|deleted|dismissed|denied)$/.test(v)) {
    return theme.colors.error;
  }
  return undefined;
}

const BORDER = {
  bottom: { cross: "┴", left: "╰", line: "─", right: "╯" },
  data: { cross: "│", left: "│", line: " ", right: "│" },
  heading: { cross: "│", left: "│", line: " ", right: "│" },
  separator: { cross: "┼", left: "├", line: "─", right: "┤" },
  top: { cross: "┬", left: "╭", line: "─", right: "╮" },
} as const;

export function WrapTable({
  columns,
  data,
  totalWidth,
}: {
  columns: Column<Row>[];
  data: Row[];
  totalWidth: number;
}) {
  const theme = useTheme();
  const borderColor = theme.colors.border;

  const natural = columns.map((col) => {
    let width = displayWidth(col.header);
    for (const row of data) {
      width = Math.max(width, displayWidth(String(row[col.key] ?? "")));
    }
    return Math.min(width, CELL_NATURAL_CAP);
  });
  const widths =
    totalWidth > 0 ? allocateWidths(natural, totalWidth, MIN_COL_WIDTH) : natural;
  const n = columns.length;

  const borderRow = (chars: (typeof BORDER)[keyof typeof BORDER]) => (
    <box flexDirection="row" flexShrink={0}>
      <text fg={borderColor}>{chars.left}</text>
      {widths.map((w, i) => (
        <Fragment key={i}>
          <text fg={borderColor}>{chars.line.repeat(w + 2)}</text>
          {i < n - 1 && <text fg={borderColor}>{chars.cross}</text>}
        </Fragment>
      ))}
      <text fg={borderColor}>{chars.right}</text>
    </box>
  );

  const cellRow = (
    cells: { text: string; color?: string }[],
    skeleton: (typeof BORDER)[keyof typeof BORDER],
    bold = false,
  ) => (
    <box flexDirection="row" flexShrink={0}>
      <text fg={borderColor}>{skeleton.left}</text>
      {widths.map((w, i) => {
        const cell = cells[i];
        const content = ` ${padDisplay(cell?.text ?? "", w, columns[i]?.align ?? "left")} `;
        return (
          <Fragment key={i}>
            {i > 0 && <text fg={borderColor}>{skeleton.cross}</text>}
            <text fg={cell?.color ?? theme.colors.foreground}>
              {bold ? <b>{content}</b> : content}
            </text>
          </Fragment>
        );
      })}
      <text fg={borderColor}>{skeleton.right}</text>
    </box>
  );

  const headerCells = columns.map((col, i) => ({
    text: truncateDisplay(col.header, widths[i] ?? 0),
    color: theme.colors.primary,
  }));

  return (
    <box flexDirection="column" flexShrink={0}>
      {borderRow(BORDER.top)}
      {cellRow(headerCells, BORDER.heading, true)}
      {borderRow(BORDER.separator)}
      {data.map((row, rowIndex) => {
        const cellLines = columns.map((col, i) =>
          wrapDisplay(String(row[col.key] ?? ""), widths[i] ?? 0),
        );
        const colors = columns.map((col) => colorFor(String(row[col.key] ?? ""), theme));
        const height = Math.max(1, ...cellLines.map((lines) => lines.length));
        return (
          <Fragment key={rowIndex}>
            {Array.from({ length: height }, (_, lineIndex) => (
              <Fragment key={lineIndex}>
                {cellRow(
                  columns.map((_, i) => ({
                    text: cellLines[i]?.[lineIndex] ?? "",
                    color: colors[i],
                  })),
                  BORDER.data,
                )}
              </Fragment>
            ))}
            {rowIndex < data.length - 1 && borderRow(BORDER.separator)}
          </Fragment>
        );
      })}
      {borderRow(BORDER.bottom)}
    </box>
  );
}
