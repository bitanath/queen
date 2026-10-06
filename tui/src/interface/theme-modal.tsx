// Theme picker. Moving the selection previews live; enter saves the choice to
// ~/.bee/queen-theme.json; esc reverts to the theme that was active on open.
import { useMemo, useState } from "react";

import { Modal } from "../components/modal";
import { useTheme, useThemeUpdater } from "../theme/use-theme";
import { saveThemeName, themeByName, themes } from "../theme/themes";

const DESCRIPTIONS: Record<string, string> = {
  default: "dark · warm orange + purple",
  purple: "dark · violet + gray",
  gruvbox: "dark · retro warm",
  nord: "dark · arctic blue",
  catppuccin: "dark · pastel mauve",
  "tokyo-night": "dark · neon blue",
};

export function ThemeModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const setTheme = useThemeUpdater();
  // Capture the theme active on open, once: preview must not move the revert target.
  const [original] = useState(theme.name);

  const options = useMemo(
    () => themes.map((t) => ({ name: t.name, description: DESCRIPTIONS[t.name] ?? "", value: t.name })),
    [],
  );
  const selectedIndex = Math.max(
    0,
    themes.findIndex((t) => t.name === theme.name),
  );

  const revertAndClose = () => {
    setTheme(themeByName(original));
    onClose();
  };

  return (
    <Modal title="theme" width={56} height={Math.max(themes.length * 2 + 12, 20)} onClose={revertAndClose}>
      <text fg={theme.colors.mutedForeground}>Arrows preview · enter saves · esc cancels</text>
      <box flexGrow={1} minHeight={0} marginTop={1}>
        <select
          focused
          flexGrow={1}
          options={options}
          height={themes.length * 2}
          selectedIndex={selectedIndex}
          showDescription
          showSelectionIndicator
          onSelect={(index) => {
            const name = themes[index]?.name;
            if (!name) return;
            setTheme(themeByName(name));
            saveThemeName(name);
            onClose();
          }}
          onChange={(index) => {
            const name = themes[index]?.name;
            if (name) setTheme(themeByName(name));
          }}
        />
      </box>
    </Modal>
  );
}
