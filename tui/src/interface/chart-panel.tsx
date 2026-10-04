import type { ReactNode } from "react";
import { useTheme } from "../theme/use-theme";


export const ChartPanel = ({ title, width, height, children }: { title: string; width?: number; height: number; children: ReactNode; }) => {
  const theme = useTheme();
  return (
    <box
      flexGrow={1}
      width={width}
      height={height}
      borderStyle="rounded"
      borderColor={theme.colors.border}
      title={title}
      titleColor={theme.colors.mutedForeground}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <box
        flexGrow={1}
        width="100%"
        minHeight={0}
        overflow="hidden"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
      >
        {children}
      </box>
    </box>
  );
};
