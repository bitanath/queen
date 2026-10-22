/* @jsxImportSource @opentui/react */
// Drill-down detail: metadata (unknowns hidden), the entity body with headings
// rendered ourselves (OpenTUI's markdown doesn't style them) in cycling colors,
// and a transcript with inferred, color-coded speakers.
import { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../theme/use-theme";
import { KeyValue } from "./key-value";
import { Divider } from "./divider";
import { labelsAreInferred, speakerLabels } from "../utils/diarize-speaker";
import type { AnswerDetail } from "../utils/answer-view";

const SPEAKER_KEYS = ["success", "warning", "info"] as const;
const HEADING_KEYS = ["accent", "info", "success", "warning", "error", "secondary"] as const;

type Theme = ReturnType<typeof useTheme>;

type Block =
  | { kind: "heading"; level: number; text: string; color: string }
  | { kind: "markdown"; content: string };

/** Split markdown into heading nodes (ours, colored) and markdown runs. */
function splitBlocks(body: string, theme: Theme): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let headingIndex = 0;

  const flush = () => {
    const content = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (content) blocks.push({ kind: "markdown", content });
    buffer = [];
  };

  for (const line of body.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      const key = HEADING_KEYS[headingIndex % HEADING_KEYS.length]!;
      blocks.push({
        kind: "heading",
        level: match[1]?.length ?? 1,
        text: (match[2] ?? "").trim(),
        color: theme.colors[key],
      });
      headingIndex += 1;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

export function DetailView({
  detail,
  markdownStyle,
}: {
  detail: AnswerDetail;
  markdownStyle: SyntaxStyle;
}) {
  const theme = useTheme();
  const transcript = detail.transcript ?? [];
  const labels = useMemo(() => speakerLabels(transcript), [detail]);
  const inferred = useMemo(() => labelsAreInferred(transcript), [detail]);
  const speakers = Array.from(new Set(labels));
  const colorFor = (speaker: string) => {
    const index = speakers.indexOf(speaker);
    const key = SPEAKER_KEYS[(index < 0 ? 0 : index) % SPEAKER_KEYS.length]!;
    return theme.colors[key];
  };
  const blocks = detail.body ? splitBlocks(detail.body, theme) : [];

  return (
    <box flexDirection="column">
      {detail.meta.length > 0 && (
        <box marginBottom={1}>
          <KeyValue items={detail.meta} />
        </box>
      )}
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <box key={index} marginTop={index === 0 ? 0 : 1} marginBottom={0}>
            <text
              fg={block.color}
              attributes={
                block.level <= 2
                  ? TextAttributes.BOLD | TextAttributes.UNDERLINE
                  : TextAttributes.BOLD
              }
            >
              {block.text}
            </text>
          </box>
        ) : (
          <markdown
            key={index}
            content={block.content}
            syntaxStyle={markdownStyle}
            streaming={false}
            tableOptions={{ widthMode: "full", style: "grid" }}
          />
        ),
      )}
      {transcript.length > 0 && (
        <box flexDirection="column">
          <box marginTop={1} marginBottom={1}>
            <Divider label="transcript" />
          </box>
          {inferred && (
            <text fg={theme.colors.mutedForeground}>
              approximately inferred using heuristics · might not be correct speaker identification
            </text>
          )}
          <box flexDirection="column" marginTop={1}>
            {transcript.map((line, index) => {
              const name = labels[index] ?? line.speaker;
              return (
                <text key={index}>
                  <span
                    fg={colorFor(name)}
                    attributes={TextAttributes.BOLD | TextAttributes.ITALIC}
                  >
                    {name}
                  </span>
                  <span fg={theme.colors.mutedForeground}>{": "}</span>
                  <span fg={theme.colors.foreground}>{line.text}</span>
                </text>
              );
            })}
          </box>
        </box>
      )}
    </box>
  );
}
