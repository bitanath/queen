/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/columns`: a row of equal-width columns. Extended
// with sizing props; `align` omitted means the columns stretch to fill height.
import React from "react";
import type { ReactNode } from "react";

export interface ColumnsProps {
  children: ReactNode;
  gap?: number;
  align?: "top" | "center" | "bottom";
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  flexGrow?: number;
  minHeight?: number;
}

const ALIGN_MAP: Record<
  NonNullable<ColumnsProps["align"]>,
  "flex-start" | "center" | "flex-end"
> = {
  bottom: "flex-end",
  center: "center",
  top: "flex-start",
};

export const Columns = ({
  children,
  gap = 0,
  align,
  width,
  height,
  flexGrow,
  minHeight,
}: ColumnsProps) => {
  const items = React.Children.toArray(children);

  return (
    <box
      flexDirection="row"
      gap={gap}
      alignItems={align ? ALIGN_MAP[align] : "stretch"}
      width={width}
      height={height}
      flexGrow={flexGrow}
      minHeight={minHeight}
    >
      {items.map((child, index) => (
        <box key={index} flexGrow={1} flexBasis={0} flexDirection="column">
          {child}
        </box>
      ))}
    </box>
  );
};
