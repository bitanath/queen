/* @jsxImportSource @opentui/react */
// NOTE: Grouped horizontal bars: one row per group, each row holds one small bar per
// cell (e.g. per week), colour-coded. Bar length ∝ |value|; solid = positive,
// shaded = negative.
import { useTheme } from "../theme/use-theme";
import { DITHER_PALETTE, type DitherColor } from "../components/dither-area-utils";
import { displayWidth, padDisplay, truncateDisplay } from "../libraries/table-format";

export interface GroupedBarsProps {
  rows: { label: string; cells: { value: number; color?: DitherColor }[] }[];
  width?: number;
  colLabels?: string[];
}

export function GroupedBars({ rows, width = 40, colLabels }: GroupedBarsProps) {
  const theme = useTheme();
  if (rows.length === 0) return <text fg={theme.colors.mutedForeground}>No data</text>;

  const nCells = Math.max(...rows.map((r) => r.cells.length));
  const labelW = Math.min(16, Math.max(...rows.map((r) => displayWidth(r.label))));
  const gap = 1;
  const barW = Math.max(
    2,
    Math.floor((width - labelW - (nCells - 1) * gap) / Math.max(1, nCells)) - gap,
  );
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => Math.abs(c.value))));

  return (
    <box flexDirection="column">
      {rows.map((row, ri) => (
        <text key={ri}>
          <span fg={theme.colors.mutedForeground}>
            {padDisplay(truncateDisplay(row.label, labelW), labelW, "left")}
          </span>
          {Array.from({ length: nCells }, (_, ci) => {
            const cell = row.cells[ci];
            const value = cell?.value ?? 0;
            const color = cell?.color
              ? (DITHER_PALETTE[cell.color] ?? theme.colors.primary)
              : theme.colors.primary;
            const filled = Math.round((Math.abs(value) / max) * barW);
            const bar = (value >= 0 ? "█" : "▒").repeat(filled) + "░".repeat(Math.max(0, barW - filled));
            return (
              <span key={ci} fg={color}>
                {` ${bar}`}
              </span>
            );
          })}
        </text>
      ))}
      {colLabels && colLabels.length > 0 && (
        <text fg={theme.colors.mutedForeground}>
          {`${" ".repeat(labelW)}${colLabels
            .slice(0, nCells)
            .map((label) => padDisplay(truncateDisplay(label, barW), barW + 1, "center"))
            .join("")}`}
        </text>
      )}
    </box>
  );
}
