import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useMemo, type ReactNode } from "react";

import { useTheme } from "./theme/use-theme";
import { Spinner } from "./components/spinner";
import { ToolCall } from "./components/tool-call";
import type { ChatMessage } from "./libraries/chat-control";

const THINK = /\x3cthink\x3e([\s\S]*?)(?:\x3c\/think\x3e|$)/g; //TODO handle thinking tokens within think tags

function QueenBody({ text, streaming, style }: { text: string; streaming: boolean; style: SyntaxStyle }) {
  const theme = useTheme();
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  THINK.lastIndex = 0;
  while ((m = THINK.exec(text))) {
    const before = text.slice(last, m.index);
    if (before.trim()) {
      nodes.push(<markdown key={key++} content={before} syntaxStyle={style} streaming={streaming} />);
    }
    const think = (m[1] ?? "").trim();
    if (think) {
      nodes.push(
        <text key={key++} fg={theme.colors.mutedForeground} attributes={TextAttributes.DIM}>
          {think}
        </text>,
      );
    }
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) {
    nodes.push(<markdown key={key++} content={tail} syntaxStyle={style} streaming={streaming} />);
  }
  return <>{nodes}</>;
}

export function Chat({
  msgs,
  streamingId,
  busy,
}: {
  msgs: ChatMessage[];
  streamingId: number | null;
  busy: boolean;
}) {
  const style = useMemo(() => SyntaxStyle.create(), []);
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        {msgs.map((m) =>
          m.role === "queen" ? (
            <box key={m.id} flexDirection="column">
              <QueenBody text={m.text} streaming={m.id === streamingId} style={style} />
              {m.tools?.map((t, i) => (
                <ToolCall
                  key={t.id}
                  name={t.name}
                  args={t.args}
                  status={t.status}
                  result={t.result}
                  duration={t.duration}
                  focus={m.id === streamingId && i === (m.tools?.length ?? 0) - 1}
                />
              ))}
            </box>
          ) : m.role === "user" ? (
            <text key={m.id}>
              <b>❯ </b>
              {m.text}
            </text>
          ) : m.role === "error" ? (
            <text key={m.id} attributes={TextAttributes.BOLD}>
              {m.text}
            </text>
          ) : (
            <text key={m.id} attributes={TextAttributes.DIM}>
              {m.text}
            </text>
          ),
        )}
        {busy && <Spinner label="thinking" />}
      </scrollbox>
    </box>
  );
}
