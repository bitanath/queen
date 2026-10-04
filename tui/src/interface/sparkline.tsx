/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/sparkline`.
import { useTheme } from "../theme/use-theme";

export interface SparklineProps {
  data: number[];
  width?: number;
  color?: string;
  label?: string;
}

const BRAILLE_LEVELS = ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿", "⣿"];
const EMPTY = "⣀";

const normalize = (data: number[], levels: number): number[] => {
  if (data.length === 0) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  if (range === 0) return data.map(() => Math.floor(levels / 2));
  return data.map((v) => Math.round(((v - min) / range) * (levels - 1)));
};

export const Sparkline = ({
  data,
  width = 20,
  color,
  label,
}: SparklineProps) => {
  const theme = useTheme();
  const resolvedColor = color ?? theme.colors.primary;

  if (data.length === 0) {
    return (
      <box>
        {label && <text fg={theme.colors.mutedForeground}>{`${label} `}</text>}
        <text fg={theme.colors.mutedForeground}>{"─".repeat(width)}</text>
      </box>
    );
  }

  const sampled =
    data.length > width
      ? Array.from(
          { length: width },
          (_, i) =>
            data[Math.round((i / (width - 1)) * (data.length - 1))] ?? 0,
        )
      : data;

  const levels = normalize(sampled, BRAILLE_LEVELS.length);
  const sparkStr = levels
    .map((l) => BRAILLE_LEVELS[l] ?? EMPTY)
    .join("");

  return (
    <box flexDirection="row" gap={1}>
      {label && <text fg={theme.colors.mutedForeground}>{label}</text>}
      <text fg={resolvedColor}>{sparkStr}</text>
    </box>
  );
};
