/* @jsxImportSource @opentui/react */
// Single-line, tail-clipped text. Use anywhere a dynamic thinking/status string
// is rendered so it can never wrap and push a sibling (e.g. the banner title)
// out of a fixed-height box — regardless of which source produced the text.
import { tailClip } from "../utils/stream-status";

export function TailLine({
  text,
  width,
  fg,
}: {
  text: string;
  width: number;
  fg?: string;
}) {
  return (
    <text fg={fg} wrapMode="none" flexShrink={0}>
      {tailClip(text, width)}
    </text>
  );
}
