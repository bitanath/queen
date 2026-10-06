/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/banner`.
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "../theme/use-theme";

export type BannerVariant =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "neutral";

const ICONS: Record<BannerVariant, string> = {
  error: "✗",
  info: "ℹ",
  neutral: "·",
  success: "✓",
  warning: "⚠",
};

export interface BannerProps {
  children: ReactNode;
  variant?: BannerVariant;
  icon?: ReactNode;
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  color?: string;
  accentChar?: string;
  gap?: number;
}

export const Banner = ({
  children,
  variant = "info",
  icon,
  title,
  dismissible = false,
  onDismiss,
  color,
  accentChar = "┃",
  gap = 1,
}: BannerProps) => {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);

  const variantColor =
    color ??
    (() => {
      switch (variant) {
        case "success":
          return theme.colors.success;
        case "error":
          return theme.colors.error;
        case "warning":
          return theme.colors.warning;
        case "neutral":
          return theme.colors.muted;
        default:
          return theme.colors.info;
      }
    })();

  useKeyboard((key) => {
    if (dismissible && key.name === "escape") {
      setDismissed(true);
      onDismiss?.();
    }
  });

  if (dismissed) return null;

  const resolvedIcon = icon ?? ICONS[variant];

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={gap}>
        <text fg={variantColor}>{accentChar}</text>
        <box flexDirection="column">
          <box flexDirection="row" gap={1}>
            {typeof resolvedIcon === "string" ? (
              <text fg={variantColor}>{resolvedIcon}</text>
            ) : (
              resolvedIcon
            )}
            {title && (
              <text fg={variantColor} wrapMode="none">
                <b>{`${title}:`}</b>
              </text>
            )}
            <text wrapMode="none" flexShrink={0}>{children}</text>
          </box>
          {dismissible && <text fg={theme.colors.mutedForeground}>press Esc to dismiss</text>}
        </box>
      </box>
    </box>
  );
};
