/* @jsxImportSource @opentui/react */
import { useTheme } from "../theme/use-theme";
import { displayWidth, padDisplay } from "../libraries/table-format";

export interface FactorBarsProps {
  rows: { label: string; value: number; highlight?: boolean }[];
  width: number;
  labelWidth?: number;
  suffix?: string;
}

export function FactorBars({ rows, width, labelWidth, suffix = "%" }: FactorBarsProps) {
  const theme = useTheme();
  if (rows.length === 0) return null;

  const lw =
    labelWidth ??
    Math.min(14, Math.max(4, ...rows.map((r) => displayWidth(r.label)), 4));
  const valueW = Math.max(3, ...rows.map((r) => displayWidth(`${r.value}${suffix}`)));
  const max = Math.max(1, ...rows.map((r) => r.value));
  const barW = Math.max(3, width - lw - valueW - 2);

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows.map((r, i) => {
        const filled = Math.max(0, Math.min(barW, Math.round((r.value / max) * barW)));
        const color = r.highlight ? theme.colors.primary : theme.colors.mutedForeground;
        return (
          <text key={i}>
            <span fg={color}>{padDisplay(r.label, lw)}</span>
            <span fg={color}>{` ${"█".repeat(filled)}${"▒".repeat(barW - filled)} `}</span>
            <span fg={theme.colors.mutedForeground}>
              {padDisplay(`${r.value}${suffix}`, valueW, "right")}
            </span>
          </text>
        );
      })}
    </box>
  );
}
