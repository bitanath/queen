/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/multi-progress`; compact rows also show the
// absolute value/total alongside the percentage, and the label is clipped
// rather than padded so the row fits narrow columns.
import { useTheme } from "../theme/use-theme";

export type MultiProgressStatus = "pending" | "running" | "done" | "error";

export interface MultiProgressItem {
  id: string;
  label: string;
  value: number;
  total: number;
  status?: MultiProgressStatus;
  statusText?: string;
}

export interface MultiProgressProps {
  items: MultiProgressItem[];
  barWidth?: number;
  labelWidth?: number;
  compact?: boolean;
  showPercent?: boolean;
  showCount?: boolean;
}

const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;

export const MultiProgress = ({
  items,
  barWidth = 20,
  labelWidth = 20,
  compact = false,
  showPercent = true,
  showCount = true,
}: MultiProgressProps) => {
  const theme = useTheme();
  const muted = theme.colors.mutedForeground;

  const statusColor = (status: MultiProgressStatus | undefined): string => {
    switch (status) {
      case "done": {
        return theme.colors.success;
      }
      case "error": {
        return theme.colors.error;
      }
      case "pending": {
        return muted;
      }
      default: {
        return theme.colors.primary;
      }
    }
  };

  const renderBar = (item: MultiProgressItem): string => {
    const pct = item.total > 0 ? Math.min(1, item.value / item.total) : 0;
    const filled = Math.round(pct * barWidth);
    return `${"█".repeat(filled)}${"░".repeat(barWidth - filled)}`;
  };

  const count = (item: MultiProgressItem): string =>
    `${item.value.toLocaleString()}/${item.total.toLocaleString()}`;

  return (
    <box flexDirection="column">
      {items.map((item) => {
        const pct =
          item.total > 0
            ? Math.min(100, Math.round((item.value / item.total) * 100))
            : 0;
        const color = statusColor(item.status);
        const bar = renderBar(item);
        if (compact) {
          return (
            <box key={item.id} flexDirection="row" gap={1}>
              <text fg={color}>{clip(item.label, labelWidth)}</text>
              <box flexDirection="row" gap={0}>
                <text fg={muted}>[</text>
                <text fg={color}>{bar}</text>
                <text fg={muted}>]</text>
              </box>
              {showPercent && <text fg={muted}>{`${String(pct).padStart(3)}%`}</text>}
              {showCount && <text fg={muted}>{count(item)}</text>}
              {item.statusText && <text fg={muted}>{item.statusText}</text>}
            </box>
          );
        }
        return (
          <box key={item.id} flexDirection="column" marginBottom={0}>
            <box flexDirection="row" gap={1}>
              <text fg={color}>
                <b>{clip(item.label, labelWidth)}</b>
              </text>
              {item.statusText && <text fg={muted}>{item.statusText}</text>}
            </box>
            <box flexDirection="row" gap={1}>
              <box flexDirection="row" gap={0}>
                <text fg={muted}>[</text>
                <text fg={color}>{bar}</text>
                <text fg={muted}>]</text>
              </box>
              {showPercent && <text fg={muted}>{`${String(pct).padStart(3)}%`}</text>}
              {showCount && <text fg={muted}>{count(item)}</text>}
            </box>
          </box>
        );
      })}
    </box>
  );
};
