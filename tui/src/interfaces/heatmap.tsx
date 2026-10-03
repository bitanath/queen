/* @jsxImportSource @opentui/react */
// Simple density heatmap. Each row is a list of numbers mapped to shade chars.
import { useTheme } from "../theme/use-theme";

export interface HeatmapProps {
  data: number[][];
  rowLabels?: string[];
  labelWidth?: number;
}

const SHADES = ["·", "░", "▒", "▓", "█"];

export const Heatmap = ({ data, rowLabels, labelWidth = 6 }: HeatmapProps) => {
  const theme = useTheme();

  if (data.length === 0 || data.every((row) => row.length === 0)) {
    return <text fg={theme.colors.mutedForeground}>No data</text>;
  }

  const flat = data.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const level = (v: number): number => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return Math.min(SHADES.length - 1, Math.max(0, Math.round(t * (SHADES.length - 1))));
  };

  return (
    <box flexDirection="column">
      {data.map((row, r) => (
        <box key={r} flexDirection="row">
          {rowLabels?.[r] !== undefined && (
            <box width={labelWidth}>
              <text fg={theme.colors.mutedForeground}>{rowLabels[r]}</text>
            </box>
          )}
          <text fg={theme.colors.primary}>{row.map((v) => SHADES[level(v)]).join("")}</text>
        </box>
      ))}
    </box>
  );
};
