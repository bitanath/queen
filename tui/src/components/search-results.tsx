/* @jsxImportSource @opentui/react */
// Ranked search hits as selectable cards: a type badge, a relevance bar, when
// it happened, and the matched text (with **match** highlighted). Arrow keys
// select (handled by the modal); the card is clickable to drill in.
import type { ReactNode } from "react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../theme/use-theme";
import { Badge, type BadgeVariant } from "./badge";
import type { SearchResult } from "../utils/answer-view";

const TYPE_VARIANT: Record<string, BadgeVariant> = {
  fact: "info",
  daily: "secondary",
  conversation: "success",
};

const SCORE_CELLS = 5;

type Theme = ReturnType<typeof useTheme>;

function renderMatch(text: string, theme: Theme): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <span
        key={i}
        bg={theme.colors.warning}
        fg={theme.colors.warningForeground}
        attributes={TextAttributes.BOLD | TextAttributes.ITALIC}
      >
        {part.slice(2, -2)}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function SearchResults({
  results,
  selected,
  onOpen,
}: {
  results: SearchResult[];
  selected: number;
  onOpen: (index: number) => void;
}) {
  const theme = useTheme();

  if (results.length === 0) {
    return (
      <box paddingLeft={1}>
        <text fg={theme.colors.mutedForeground}>No results</text>
      </box>
    );
  }

  const maxScore = Math.max(1, ...results.map((result) => result.score));

  return (
    <box flexDirection="column">
      <box paddingLeft={1} paddingRight={1} marginBottom={1}>
        <text fg={theme.colors.mutedForeground}>↑↓ select · ↵ open</text>
      </box>
      {results.map((result, index) => {
        const variant = TYPE_VARIANT[result.type.toLowerCase()] ?? "default";
        const accent =
          variant === "info"
            ? theme.colors.info
            : variant === "secondary"
              ? theme.colors.secondary
              : variant === "success"
                ? theme.colors.success
                : theme.colors.border;
        const active = index === selected;
        const filled = Math.max(1, Math.round((result.score / maxScore) * SCORE_CELLS));
        const bar = "▮".repeat(filled) + "▯".repeat(SCORE_CELLS - filled);

        return (
          <box
            key={index}
            id={`search-result-${index}`}
            flexDirection="column"
            borderStyle="rounded"
            borderColor={active ? theme.colors.focusRing : accent}
            paddingLeft={1}
            paddingRight={1}
            marginBottom={1}
            onMouseDown={() => onOpen(index)}
          >
            <box flexDirection="row" gap={1}>
              <text fg={active ? theme.colors.primary : theme.colors.mutedForeground}>
                {active ? "❯" : " "}
              </text>
              <text fg={theme.colors.mutedForeground}>{`${index + 1}.`}</text>
              <Badge variant={variant} bordered={false}>
                {result.type}
              </Badge>
              <text fg={theme.colors.mutedForeground}>{`· ${result.when} · ${bar} ${result.score.toFixed(2)}`}</text>
            </box>
            <text fg={theme.colors.foreground}>{renderMatch(result.title, theme)}</text>
            {result.snippet && result.snippet !== result.title && (
              <text fg={theme.colors.mutedForeground}>{renderMatch(result.snippet, theme)}</text>
            )}
          </box>
        );
      })}
    </box>
  );
}
