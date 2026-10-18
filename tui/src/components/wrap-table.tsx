/* @jsxImportSource @opentui/react */
//NOTE: - Full-width table for the answer modal. Actually formatted and looks good.
import { Fragment } from "react";

import { useTheme } from "../theme/use-theme";
import {
  allocateWidths,
  displayWidth,
  ellipsizeDisplay,
  padDisplay,
  truncateDisplay,
  wrapDisplay,
} from "../libraries/table-format";
import type { Column } from "./table";

type Row = Record<string, unknown>;

const CELL_NATURAL_CAP = 40;
const MIN_COL_WIDTH = 4;

type Theme = ReturnType<typeof useTheme>;

// Value-based coloring: booleans and common status enums because why not.
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
  maxRows,
  maxRowLines,
}: {
  columns: Column<Row>[];
  data: Row[];
  totalWidth: number;
  maxRows?: number;
  maxRowLines?: number;
}) {
  const theme = useTheme();
  const borderColor = theme.colors.border;

  const dataNat = columns.map((col) => {
    let width = MIN_COL_WIDTH;
    for (const row of data) {
      width = Math.max(width, displayWidth(String(row[col.key] ?? "")));
    }
    return Math.min(width, CELL_NATURAL_CAP);
  });
  
  const headerNat = columns.map((col, i) =>
    Math.max(dataNat[i] ?? MIN_COL_WIDTH, displayWidth(col.header)),
  ); //HACK please please let the headers wrap
  const overhead = 3 * columns.length + 1;
  const headFits =
    totalWidth > 0 &&
    headerNat.reduce((a, b) => a + b, 0) + overhead <= totalWidth;
  const natural = headFits ? headerNat : dataNat;
  const widths =
    totalWidth > 0 ? allocateWidths(natural, totalWidth, MIN_COL_WIDTH) : natural;
  const n = columns.length;
  const visible = maxRows !== undefined ? data.slice(0, maxRows) : data;

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

  const headerLines = columns.map((col, i) => {
    const w = widths[i] ?? 0;
    const oneLine = wrapDisplay(col.header, w);
    if (oneLine.length === 1) return oneLine;
    return wrapDisplay(col.header.replace(/%/g, " %").trim(), w); //HACK Prefer a clean break before a trailing "%" rather than a hard break.
  });
  const headerHeight = Math.max(1, ...headerLines.map((lines) => lines.length));

  return (
    <box flexDirection="column" flexShrink={0}>
      {borderRow(BORDER.top)}
      {Array.from({ length: headerHeight }, (_, li) => (
        <Fragment key={`h-${li}`}>
          {cellRow(
            columns.map((_, i) => ({ text: headerLines[i]?.[li] ?? "", color: theme.colors.primary })),
            BORDER.heading,
            true,
          )}
        </Fragment>
      ))}
      {borderRow(BORDER.separator)}
      {visible.map((row, rowIndex) => {
        const cellLines = columns.map((col, i) => {
          const lines = wrapDisplay(String(row[col.key] ?? ""), widths[i] ?? 0);
          if (maxRowLines === undefined || lines.length <= maxRowLines) return lines;
          const kept = lines.slice(0, maxRowLines);
          kept[maxRowLines - 1] = ellipsizeDisplay(kept[maxRowLines - 1] ?? "", widths[i] ?? 0);
          return kept;
        });
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
            {rowIndex < visible.length - 1 && borderRow(BORDER.separator)}
          </Fragment>
        );
      })}
      {data.length > visible.length
        ? (() => {
            const innerWidth = widths.reduce((a, b) => a + b, 0) + widths.length * 3 - 3;
            const msg = `… ${data.length - visible.length} more rows`;
            return (
              <box flexDirection="row" flexShrink={0}>
                <text fg={borderColor}>│</text>
                <text fg={theme.colors.mutedForeground}>{` ${padDisplay(msg, innerWidth)} `}</text>
                <text fg={borderColor}>│</text>
              </box>
            );
          })()
        : null}
      {borderRow(BORDER.bottom)}
    </box>
  );
}
