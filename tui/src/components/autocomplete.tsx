/* @jsxImportSource @opentui/react */
// Slash-command dropdown shown above the prompt while the user types "/". The
// textarea keeps focus; keyboard handling lives in the dashboard. The list is
// windowed so the selected item is always visible.
import { useTheme } from "../theme/use-theme";

export type AutocompleteOption = { name: string; label: string; description: string };

export function Autocomplete({
  options,
  selected,
  maxHeight = 10,
}: {
  options: AutocompleteOption[];
  selected: number;
  maxHeight?: number;
}) {
  const theme = useTheme();
  const total = options.length;
  const size = Math.min(maxHeight, Math.max(1, total));
  const start = selected >= size ? selected - size + 1 : 0;
  const visible = options.slice(start, start + size);
  const hiddenAbove = start;
  const hiddenBelow = Math.max(0, total - start - visible.length);

  return (
    <box
      borderStyle="rounded"
      borderColor={theme.colors.border}
      flexDirection="column"
      flexShrink={0}
    >
      {hiddenAbove > 0 && (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.mutedForeground}>{`↑ ${hiddenAbove} more`}</text>
        </box>
      )}
      {visible.length === 0 ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.mutedForeground}>No matching items</text>
        </box>
      ) : (
        visible.map((opt, i) => {
          const index = start + i;
          const active = index === selected;
          const fg = active ? theme.colors.background : theme.colors.foreground;
          const dim = active ? theme.colors.background : theme.colors.mutedForeground;
          return (
            <box
              key={opt.name}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={active ? theme.colors.primary : undefined}
            >
              <text fg={fg} flexShrink={0}>{`/${opt.label}`}</text>
              <text fg={dim} wrapMode="none">{`  ${opt.description}`}</text>
            </box>
          );
        })
      )}
      {hiddenBelow > 0 && (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.mutedForeground}>{`↓ ${hiddenBelow} more`}</text>
        </box>
      )}
    </box>
  );
}
