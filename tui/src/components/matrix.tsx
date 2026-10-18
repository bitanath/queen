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
}: MatrixProps) {
  const theme = useTheme();
  if (data.length === 0 || colLabels.length === 0) {
    return <text fg={theme.colors.mutedForeground}>No data</text>;
  }

  const lw =
    labelWidth ??
    Math.min(14, Math.max(4, ...rowLabels.map((label) => displayWidth(label))));

  const available = Math.max(colLabels.length * 3, totalWidth - lw - 1);
  const cellW = Math.max(3, Math.min(16, Math.floor(available / colLabels.length)));

  const colorFor = (v: number): string => {
    if (Math.abs(v) < 0.1) return theme.colors.mutedForeground;
    return v >= 0 ? theme.colors.success : theme.colors.error;
  }; //TODO Neo you are the one

  const header = colLabels.map((c) => padDisplay(truncateDisplay(c, cellW), cellW, "center")).join("");

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.colors.mutedForeground}>{`${" ".repeat(lw)}${header}`}</text>
      {rowLabels.map((label, r) => (
        <text key={r}>
          <span fg={theme.colors.primary}>{padDisplay(label, lw)}</span>
          {(data[r] ?? []).map((v, c) => (
            <span
              key={c}
              fg={colorFor(v)}
              attributes={Math.abs(v) >= 0.3 ? TextAttributes.BOLD : 0}
            >
              {showValues ? padDisplay(fmt(v), cellW, "center") : padDisplay(Math.abs(v) >= 0.3 ? "█" : "▒", cellW, "center")}
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}
