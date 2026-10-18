/* @jsxImportSource @opentui/react */
import { useEffect, useState } from "react";

import { useTheme } from "../theme/use-theme";

export interface ThinkingBlockProps {
  content: string;
  streaming?: boolean;
  defaultCollapsed?: boolean;
  label?: string;
  tokenCount?: number;
  duration?: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const ThinkingBlock = ({
  content,
  streaming = false,
  defaultCollapsed = true,
  label = "Thought",
  tokenCount,
  duration,
}: ThinkingBlockProps) => {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [frame, setFrame] = useState(0);

  
  useEffect(() => {
    if (!streaming) return; //HACK Only animate while the model is working; a settled block needs no timer.
    const id = setInterval(() => setFrame((f) => f + 1), Math.round(1000 / 12));
    return () => clearInterval(id); 
  }, [streaming]);

  const spinnerIcon = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
  const tokenStr = tokenCount === undefined ? null : `${tokenCount.toLocaleString()} tokens`;
  const durationStr = duration === undefined ? null : `${(duration / 1000).toFixed(1)}s`;
  const headerText = [streaming ? "Thinking…" : label, tokenStr, durationStr].filter(Boolean).join(" · ");

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" gap={1} alignItems="center" onMouseDown={() => setCollapsed((c) => !c)}>
        <text fg={theme.colors.mutedForeground}>{collapsed ? "▶" : "▼"}</text>
        {streaming && <text fg={theme.colors.primary}>{spinnerIcon}</text>}
        <text fg={streaming ? theme.colors.primary : theme.colors.mutedForeground} wrapMode="none">
          {headerText}
        </text>
      </box>

      {!collapsed && (
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme.colors.mutedForeground}>{content}</text>
        </box>
      )}
    </box>
  );
};
