/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/tool-call`. `focus` gates the global keyboard
// handler so many mounted tool calls don't all toggle at once.
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "../theme/use-theme";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

export interface ToolCallProps {
  name: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  duration?: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  focus?: boolean;
}

export const ToolCall = ({
  name,
  args,
  status,
  result,
  duration,
  collapsible = true,
  defaultCollapsed = true,
  focus = true,
}: ToolCallProps) => {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const [frame, setFrame] = useState(0);

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerIcon = spinnerFrames[frame % spinnerFrames.length] ?? "⠋";

  // Only animate while a call is in flight; idle calls don't need a timer.
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setFrame((f) => f + 1), Math.round(1000 / 12));
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (status !== "running") {
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [status]);

  useKeyboard((key) => {
    if (!focus) return;
    if (collapsible && (key.name === "return" || key.name === " ")) {
      setCollapsed((c) => !c);
    }
  });

  const statusIcon = () => {
    switch (status) {
      case "pending": {
        return <text fg={theme.colors.mutedForeground}>○</text>;
      }
      case "running": {
        return <text fg={theme.colors.primary}>{spinnerIcon}</text>;
      }
      case "success": {
        return <text fg={theme.colors.success}>✓</text>;
      }
      case "error": {
        return <text fg={theme.colors.error}>✗</text>;
      }
      default: {
        break;
      }
    }
  };

  let durationText: string | null;
  if (duration === undefined) {
    durationText = status === "running" ? `${elapsed}ms` : null;
  } else {
    durationText = `${duration}ms`;
  }

  let nameColor: string;
  if (status === "error") {
    nameColor = theme.colors.error;
  } else if (status === "success") {
    nameColor = theme.colors.success;
  } else if (status === "running") {
    nameColor = theme.colors.primary;
  } else {
    nameColor = theme.colors.mutedForeground;
  }

  return (
    <box flexDirection="column">
      <box gap={1}>
        {statusIcon()}
        <text fg={nameColor}>{status !== "pending" ? <b>{name}</b> : name}</text>
        {durationText && (
          <text fg={theme.colors.mutedForeground}>{`(${durationText})`}</text>
        )}
        {collapsible && <text fg={theme.colors.mutedForeground}>{collapsed ? "▶" : "▼"}</text>}
      </box>

      {!collapsed && (
        <box flexDirection="column" paddingLeft={2}>
          {args && Object.keys(args).length > 0 && (
            <box flexDirection="column">
              <text fg={theme.colors.mutedForeground}>Args:</text>
              {Object.entries(args).map(([k, v]) => (
                <box key={k} gap={1}>
                  <text fg={theme.colors.accent}>{`${k}:`}</text>
                  <text fg={theme.colors.mutedForeground}>{JSON.stringify(v)}</text>
                </box>
              ))}
            </box>
          )}
          {result !== undefined && (
            <box flexDirection="column">
              <text fg={theme.colors.mutedForeground}>Result:</text>
              <text fg={theme.colors.mutedForeground}>
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </text>
            </box>
          )}
        </box>
      )}
    </box>
  );
};
