/* @jsxImportSource @opentui/react */
import { useTheme } from "../theme/use-theme";
import { TextAttributes } from "@opentui/core";
import { displayWidth, padDisplay, truncateDisplay } from "../libraries/table-format";

export interface MatrixProps {
  rowLabels: string[];
  colLabels: string[];
  data: number[][];
  showValues?: boolean;
  totalWidth?: number;
  labelWidth?: number;
  highlightCol?: number;
}

export function matrixLayout(
  rowLabels: string[],
  colLabels: string[],
  totalWidth = 80,
  labelWidth?: number,
): { lw: number; cellW: number; width: number } {
  const lw =
    labelWidth ??
    Math.min(14, Math.max(4, ...rowLabels.map((label) => displayWidth(label)), 4));
  const cols = colLabels.length;
  const available = Math.max(cols * 3, totalWidth - lw - 1);
  const cellW = Math.max(3, Math.min(16, Math.floor(available / Math.max(1, cols))));
  return { lw, cellW, width: lw + cols * cellW };
}

function fmt(v: number): string {
  const s = Math.abs(v).toFixed(2).replace(/^0/, "");
  return `${v >= 0 ? "+" : "-"}${s}`;
}

export function Matrix({
  rowLabels,
  colLabels,
  data,
  showValues = true,
  totalWidth = 80,
  labelWidth,
  highlightCol = -1,
}: MatrixProps) {
  const theme = useTheme();
  if (data.length === 0 || colLabels.length === 0) {
    return <text fg={theme.colors.mutedForeground}>No data</text>;
  }

  const { lw, cellW } = matrixLayout(rowLabels, colLabels, totalWidth, labelWidth);

  const muted = (c: number): boolean => highlightCol >= 0 && c !== highlightCol;

  const colorFor = (v: number, c: number): string => {
    if (muted(c)) return theme.colors.mutedForeground;
    if (Math.abs(v) < 0.1) return theme.colors.mutedForeground;
    return v >= 0 ? theme.colors.success : theme.colors.error;
  };

  const boldFor = (v: number, c: number): number =>
    !muted(c) && Math.abs(v) >= 0.3 ? TextAttributes.BOLD : 0;

  return (
    <box flexDirection="column" flexShrink={0}>
      <text>
        <span fg={theme.colors.mutedForeground}>{" ".repeat(lw)}</span>
        {colLabels.map((c, i) => (
          <span
            key={i}
            fg={muted(i) ? theme.colors.mutedForeground : theme.colors.primary}
            attributes={!muted(i) && highlightCol >= 0 ? TextAttributes.BOLD : 0}
          >
            {padDisplay(truncateDisplay(c, cellW), cellW, "center")}
          </span>
        ))}
      </text>
      {rowLabels.map((label, r) => (
        <text key={r}>
          <span fg={theme.colors.primary}>{padDisplay(label, lw)}</span>
          {(data[r] ?? []).map((v, c) => (
            <span
              key={c}
              fg={colorFor(v, c)}
              attributes={boldFor(v, c)}
            >
              {showValues ? padDisplay(fmt(v), cellW, "center") : padDisplay(Math.abs(v) >= 0.3 ? "█" : "▒", cellW, "center")}
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}
