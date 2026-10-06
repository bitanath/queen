// Help overlay: commands, keybindings, and a short about section.
import { Modal } from "../components/modal";
import { useTheme } from "../theme/use-theme";

export const COMMANDS: [string, string][] = [
  ["/activity", "recent Bee activity across conversations, summaries, notes, todos, insights"],
  ["/today [--context]", "today's brief (calendar + emails); --context for wearable context"],
  ["/now", "recent conversations with utterances"],
  ["/changed", "recently changed entities"],
  ["/conversations", "list developer conversations"],
  ["/daily", "list daily summaries"],
  ["/facts", "list developer facts"],
  ["/insights", "list Bee insights"],
  ["/journals", "list developer journals"],
  ["/locations [--current]", "location clusters, or the current location with --current"],
  ["/me", "fetch the developer profile"],
  ["/search <q> [--limit N]", "search Bee conversations"],
  ["/status", "auth + connection status"],
  ["/login [--qr | --token <t>]", "connect the Bee app"],
  ["/logout", "clear stored credentials"],
  ["/theme", "open the theme switcher"],
  ["/help", "this command reference"],
  ["/commands", "alias of /help"],
  ["/quit", "exit"],
];

const KEYS: [string, string][] = [
  ["ctrl+t", "theme switcher"],
  ["ctrl+p", "this help"],
  ["ctrl+k", "all commands"],
  ["mouse drag", "select text · auto-copies"],
  ["enter", "send message"],
  ["esc", "clear input / cancel / close"],
  ["ctrl+c", "quit"],
];

function Row({ label, text, labelColor, textColor }: { label: string; text: string; labelColor: string; textColor: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <box width={24}>
        <text fg={labelColor}>{label}</text>
      </box>
      <text fg={textColor}>{text}</text>
    </box>
  );
}

function Section({ title, color }: { title: string; color: string }) {
  return (
    <box marginTop={1}>
      <text fg={color}>
        <b>{title}</b>
      </text>
    </box>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();

  return (
    <Modal title="help" width={68} height={24} onClose={onClose}>
      <scrollbox flexGrow={1} minHeight={0}>
        <text fg={theme.colors.foreground}>
          <b>queen</b> — a single-file chat binary: local GGUF inference via the
          embedded elthur dylib, with Bee tools when you're logged in.
        </text>

        <Section title="commands" color={theme.colors.primary} />
        {COMMANDS.map(([label, text]) => (
          <Row key={label} label={label} text={text} labelColor={theme.colors.accent} textColor={theme.colors.mutedForeground} />
        ))}

        <Section title="keys" color={theme.colors.primary} />
        {KEYS.map(([label, text]) => (
          <Row key={label} label={label} text={text} labelColor={theme.colors.accent} textColor={theme.colors.mutedForeground} />
        ))}
      </scrollbox>
    </Modal>
  );
}
