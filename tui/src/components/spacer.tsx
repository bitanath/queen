/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/spacer`: flexible space between flex children.
export interface SpacerProps {
  size?: number;
  direction?: "horizontal" | "vertical";
}

export const Spacer = ({ size, direction = "horizontal" }: SpacerProps) => {
  if (size === undefined) {
    return <box flexGrow={1} />;
  }

  if (direction === "vertical") {
    return <box height={size} />;
  }

  return <box width={size} />;
};
