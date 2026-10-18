import { useTerminalDimensions } from "@opentui/react";

import { useTheme } from "../theme/use-theme";
import { Columns } from "../components/columns";
import { Spacer } from "../components/spacer";

// One-row hint bar at the bottom. The bar is transparent; each shortcut is a
// small colored chip (`key · purpose`). Chips sit in even termcn Columns, with a
// leading and trailing Spacer so the whole set is centred, and each chip is
// centred within its column. Only the single row above is spacing.
const ITEMS: [string, string][] = [
  ["tab", "focus"],
  ["enter", "select"],
  ["esc", "cancel"],
  ["ctrl+t", "actions/chat"],
  ["ctrl+d", "theme"],
  ["ctrl+c", "quit"],
];

export function StatusBar() {
  const theme = useTheme();
  const { width } = useTerminalDimensions();
  return (
    <box width={width} height={1} flexShrink={0} marginTop={1}>
      <Columns>
        <Spacer />
        {ITEMS.map(([key, purpose]) => (
          <box key={key} flexDirection="row" justifyContent="center">
            <box
              backgroundColor={theme.colors.secondary}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.colors.secondaryForeground}>
                <b>{key}</b> · {purpose} {/*NOTE we show only themeing*/}
              </text>
            </box>
          </box>
        ))}
        <Spacer />
      </Columns>
    </box>
  );
}
