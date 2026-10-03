/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/stack`; gained flexGrow/flexShrink/minHeight so it
// can fill available space.
import type { ReactNode } from "react";

export interface StackProps {
  direction?: "vertical" | "horizontal";
  gap?: number;
  children: ReactNode;
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  flexGrow?: number;
  flexShrink?: number;
  minHeight?: number;
  alignItems?: "flex-start" | "center" | "flex-end";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around";
}

export const Stack = ({
  direction = "vertical",
  gap = 0,
  children,
  width,
  height,
  flexGrow,
  flexShrink,
  minHeight,
  alignItems,
  justifyContent,
}: StackProps) => (
  <box
    flexDirection={direction === "vertical" ? "column" : "row"}
    gap={gap}
    width={width}
    height={height}
    flexGrow={flexGrow}
    flexShrink={flexShrink}
    minHeight={minHeight}
    alignItems={alignItems}
    justifyContent={justifyContent}
  >
    {children}
  </box>
);
