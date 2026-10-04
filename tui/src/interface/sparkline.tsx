/* @jsxImportSource @opentui/react */
// Dither sparkline, reduced from termcn `opentui/dither-sparkline`.
import { useTheme } from "../theme/use-theme";
import {
  DITHER_PALETTE,
  renderSparkline,
  type DitherColor,
  type DitherVariant,
} from "../components/sparkline-utils";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: DitherColor;
  label?: string;
  variant?: DitherVariant;
  markerIndex?: number;
}

export const Sparkline = ({
  data,
  width = 20,
  height = 4,
  color = "blue",
  label,
  variant = "gradient",
  markerIndex,
}: SparklineProps) => {
  const theme = useTheme();
  const resolvedColor = DITHER_PALETTE[color] ?? theme.colors.primary;

  if (data.length === 0) {
    return (
      <box flexDirection="row" gap={1}>
        {label && <text fg={theme.colors.mutedForeground}>{label}</text>}
        <text fg={theme.colors.mutedForeground}>{"─".repeat(width)}</text>
      </box>
    );
  }

  const frame = renderSparkline(data, {
    width,
    height,
    variant,
    ...(markerIndex !== undefined ? { markerIndex } : {}),
  });

  return (
    <box flexDirection="column">
      {label && <text fg={theme.colors.mutedForeground}>{label}</text>}
      {frame.map((row, index) => (
        <text key={index} fg={resolvedColor}>
          {row.map((cell) => cell.char).join("")}
        </text>
      ))}
    </box>
  );
};
