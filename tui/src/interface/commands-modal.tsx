// Command reference. Arrow keys scroll the list; enter or esc closes.
import { Modal } from "../components/modal";
import { useTheme } from "../theme/use-theme";
import { COMMANDS } from "./help-modal";

export function CommandsModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const options = COMMANDS.map(([name, description]) => ({ name, description, value: name }));

  return (
    <Modal
      title="commands"
      width={64}
      height={Math.max(COMMANDS.length * 2 + 8, 20)}
      onClose={onClose}
    >
      <text fg={theme.colors.mutedForeground}>↑↓ scroll · ↵ select</text>
      <box flexGrow={1} minHeight={0} marginTop={1}>
        <select
          focused
          flexGrow={1}
          options={options}
          height={COMMANDS.length * 2}
          showDescription
          showSelectionIndicator
          onSelect={() => onClose()}
        />
      </box>
    </Modal>
  );
}
