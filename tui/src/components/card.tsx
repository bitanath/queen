/* @jsxImportSource @opentui/react */
// Ported from termcn `opentui/card`;  title inside top border of card haha
import type { ReactNode } from "react";
import { useTheme } from "../theme/use-theme";
import type { BorderStyle } from "../theme/types";

export interface CardProps {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  borderColor?: string;
  width?: number;
  height?: number | `${number}%`;
  borderStyle?: BorderStyle;
  paddingX?: number;
  paddingY?: number;
  footerDividerChar?: string;
}

export const Card = ({
  title,
  children,
  footer,
  borderColor,
  width,
  height,
  borderStyle = "rounded",
  paddingX = 1,
  paddingY = 0,
  footerDividerChar = "─",
}: CardProps) => {
  const theme = useTheme();
  const resolvedBorderColor = borderColor ?? theme.colors.border;

  return (
    <box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={resolvedBorderColor}
      title={title ? ` ${title} ` : undefined}
      width={width}
      height={height}
      paddingLeft={paddingX}
      paddingRight={paddingX}
      paddingTop={paddingY}
      paddingBottom={paddingY}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">{children}</box>
      {footer && (
        <box flexDirection="column" marginTop={1} paddingTop={1}>
          <text fg={resolvedBorderColor}>{footerDividerChar.repeat(30)}</text>
          <box marginTop={0}>{footer}</box>
        </box>
      )}
    </box>
  );
};
