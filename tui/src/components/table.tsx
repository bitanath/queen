/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/table`, adapted two ways:
//   1. static — the arrow/s/return keyboard handling is removed, so a table in
//      the layout never steals keys from the chat input;
//   2. full width — `totalWidth` feeds `fitWidths()` (libs/table-format), which
//      borrows markdown-table-formatter's column-width/alignment logic and
//      stretches columns to fill the pane exactly.
import { useTheme } from "../theme/use-theme";
import { fitWidths } from "../libraries/table-format";

export interface Column<T = Record<string, unknown>> {
  key: keyof T & string;
  header: string;
  width?: number;
  align?: "left" | "right" | "center";
}

export interface TableProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  data: T[];
  columns: Column<T>[];
  maxRows?: number;
  borderColor?: string;
  /** Fill this many terminal columns exactly. */
  totalWidth?: number;
}

const BORDER = {
  bottom: { cross: "┴", left: "╰", line: "─", right: "╯" },
  data: { cross: "│", left: "│", line: " ", right: "│" },
  heading: { cross: "│", left: "│", line: " ", right: "│" },
  separator: { cross: "┼", left: "├", line: "─", right: "┤" },
  top: { cross: "┬", left: "╭", line: "─", right: "╮" },
} as const;

const pad = (
  str: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string => {
  const s = String(str);
  if (s.length >= width) return s.slice(0, width);
  const diff = width - s.length;
  if (align === "right") return " ".repeat(diff) + s;
  if (align === "center") {
    const l = Math.floor(diff / 2);
    return " ".repeat(l) + s + " ".repeat(diff - l);
  }
  return s + " ".repeat(diff);
};

const intersperse = <T,>(items: T[], separator: (index: number) => T): T[] => {
  const result: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) result.push(separator(i));
    const item = items[i];
    if (item !== undefined) result.push(item);
  }
  return result;
};

interface SkeletonChars {
  left: string;
  right: string;
  cross: string;
  line: string;
}

const SkeletonRow = ({
  widths,
  skeleton,
  color,
}: {
  widths: number[];
  skeleton: SkeletonChars;
  color: string;
}) => (
  <box flexDirection="row" flexShrink={0}>
    <text fg={color}>{skeleton.left}</text>
    {intersperse(
      widths.map((w, i) => (
        <text key={i} fg={color}>
          {skeleton.line.repeat(w + 2)}
        </text>
      )),
      (i) => (
        <text key={`sep-${i}`} fg={color}>
          {skeleton.cross}
        </text>
      ),
    )}
    <text fg={color}>{skeleton.right}</text>
  </box>
);

const CellRow = ({
  widths,
  cells,
  skeleton,
  borderColor,
  textColor,
  bold,
}: {
  widths: number[];
  cells: { text: string; align: "left" | "right" | "center" }[];
  skeleton: SkeletonChars;
  borderColor: string;
  textColor: string;
  bold?: boolean;
}) => (
  <box flexDirection="row" flexShrink={0}>
    <text fg={borderColor}>{skeleton.left}</text>
    {intersperse(
      cells.map((cell, i) => {
        const content = ` ${pad(cell.text, widths[i] ?? 0, cell.align)} `;
        return (
          <text key={i} fg={textColor}>
            {bold ? <b>{content}</b> : content}
          </text>
        );
      }),
      (i) => (
        <text key={`sep-${i}`} fg={borderColor}>
          {skeleton.cross}
        </text>
      ),
    )}
    <text fg={borderColor}>{skeleton.right}</text>
  </box>
);

export const Table = <
  T extends Record<string, unknown> = Record<string, unknown>,
>({
  data,
  columns,
  maxRows = 20,
  borderColor,
  totalWidth,
}: TableProps<T>) => {
  const theme = useTheme();
  const resolvedBorderColor = borderColor ?? theme.colors.border;
  const visible = data.slice(0, maxRows);

  const natural = columns.map((col) => {
    if (col.width !== undefined) return col.width;
    let width = col.header.length;
    for (const row of data) {
      width = Math.max(width, String(row[col.key] ?? "").length);
    }
    return width;
  });
  const colWidths =
    totalWidth !== undefined && totalWidth > 0
      ? fitWidths(natural, totalWidth)
      : natural;

  const headerCells = columns.map((col) => ({
    align: col.align ?? ("left" as const),
    text: col.header,
  }));

  return (
    <box flexDirection="column" overflow="hidden">
      <SkeletonRow
        widths={colWidths}
        skeleton={BORDER.top}
        color={resolvedBorderColor}
      />
      <CellRow
        widths={colWidths}
        cells={headerCells}
        skeleton={BORDER.heading}
        borderColor={resolvedBorderColor}
        textColor={theme.colors.primary}
        bold
      />
      <SkeletonRow
        widths={colWidths}
        skeleton={BORDER.separator}
        color={resolvedBorderColor}
      />
      {visible.map((row, rowIdx) => {
        const rowCells = columns.map((col) => ({
          align: col.align ?? ("left" as const),
          text: String(row[col.key] ?? ""),
        }));
        return (
          <CellRow
            key={rowIdx}
            widths={colWidths}
            cells={rowCells}
            skeleton={BORDER.data}
            borderColor={resolvedBorderColor}
            textColor={theme.colors.foreground}
          />
        );
      })}
      {data.length > maxRows
        ? (() => {
            const innerWidth =
              colWidths.reduce((a, b) => a + b, 0) + colWidths.length * 3 - 3;
            const msg = `… ${data.length - maxRows} more rows`;
            return (
              <box flexDirection="row" flexShrink={0}>
                <text fg={resolvedBorderColor}>│</text>
                <text
                  fg={theme.colors.mutedForeground}
                >{` ${pad(msg, innerWidth)} `}</text>
                <text fg={resolvedBorderColor}>│</text>
              </box>
            );
          })()
        : null}
      <SkeletonRow
        widths={colWidths}
        skeleton={BORDER.bottom}
        color={resolvedBorderColor}
      />
    </box>
  );
};
