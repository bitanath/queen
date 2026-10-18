/* @jsxImportSource @opentui/react */
// NOTE: Simplified dithered area chart (termcn port)
import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../theme/use-theme";
import { DITHER_PALETTE, renderDitherArea, type AreaVariant, type DitherCell, type DitherColor, } from "../utils/dither-area-utils";

export interface DitherAreaChartProps {
  data: { label?: string; value: number }[];
  color?: DitherColor;
  variant?: AreaVariant;
  width?: number;
  height?: number;
  showGrid?: boolean;
  showAxes?: boolean;
}

function Tick({ cells, fallback }: { cells: DitherCell[]; fallback: string }) {
  const runs: { text: string; color: string; bold: boolean }[] = [];
  for (const cell of cells) {
    const color = cell.color ?? fallback;
    const last = runs[runs.length - 1];
    if (last && last.color === color && last.bold === Boolean(cell.bold)) last.text += cell.char;
    else runs.push({ text: cell.char, color, bold: Boolean(cell.bold) });
  }
  return (
    <text>
      {runs.map((run, i) => (
        <span key={i} fg={run.color} attributes={run.bold ? TextAttributes.BOLD : 0}>
          {run.text}
        </span>
      ))}
    </text>
  );
}

export function DitherAreaChart({  data,
  color,
  variant = "gradient",
  width = 56,
  height = 10,
  showGrid = true,
  showAxes = true,
}: DitherAreaChartProps) {
  const theme = useTheme();
  const seriesColor = color ? (DITHER_PALETTE[color] ?? theme.colors.primary) : theme.colors.primary;

  const rows = useMemo(
    () =>
      renderDitherArea({
        values: data.map((d) => d.value),
        labels: data.map((d) => d.label ?? ""),
        width,
        height,
        variant,
        showGrid,
        showAxes,
        seriesColor,
        axisColor: theme.colors.mutedForeground,
        gridColor: theme.colors.border,
      }),
    [data, width, height, variant, showGrid, showAxes, seriesColor, theme.colors.mutedForeground, theme.colors.border],
  );

  if (data.length === 0) {
    return <text fg={theme.colors.mutedForeground}>No data</text>;
  }

  return (
    <box flexDirection="column">
      {rows.map((cells, i) => (
        <Tick key={i} cells={cells} fallback={seriesColor} />
      ))}
    </box>
  );
}

