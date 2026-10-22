//TODO: One-shot CLI cards rendered through OpenTUI's scrollback API, for command only interface
import {
  BoxRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  TextAttributes,
  TextRenderable,
  TextTableRenderable,
  type CliRenderer,
  type RenderContext,
  type TextChunk,
} from "@opentui/core";

import { displayWidth, naturalWidths } from "../libraries/table-format";

export type CardAlign = "left" | "right" | "center";

export type CardSection =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "keyValues"; items: { key: string; value: string }[] }
  | { kind: "markdown"; content: string }
  | { kind: "table"; columns: string[]; rows: (string | number)[][]; aligns?: CardAlign[] }
  | { kind: "gauge"; label: string; ratio: number; detail?: string }
  | { kind: "progress"; label: string; ratio: number };

export type CardSpec = {
  title: string;
  subtitle?: string;
  sections: CardSection[];
  footer?: string;
  data?: unknown; //NOTE: machine-readable payload for --json, never rendered
};

const MIN_CARD_WIDTH = 36;

function chunk(text: string, attributes?: number): TextChunk {
  return {
    __isChunk: true,
    text,
    ...(attributes !== undefined ? { attributes } : {}),
  };
}

function bar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function textWidth(text: string): number {
  return text.split("\n").reduce((max, line) => Math.max(max, displayWidth(line)), 0);
}

function sectionWidth(section: CardSection): number {
  switch (section.kind) {
    case "heading":
    case "text":
      return textWidth(section.text);
    case "keyValues":
      return textWidth(section.items.map((item) => `${item.key}: ${item.value}`).join("\n"));
    case "markdown":
      return textWidth(section.content);
    case "table": {
      const widths = naturalWidths(section.columns, section.rows.map((row) => row.map(String)));
      return widths.reduce((sum, width) => sum + width, 0) + 3 * widths.length + 1;
    }
    case "gauge":
      return displayWidth(
        `${section.label} ${bar(section.ratio)}${section.detail ? `  ${section.detail}` : ""}`,
      );
    case "progress":
      return displayWidth(
        `${section.label} ${bar(section.ratio)}  ${Math.round(section.ratio * 100)}%`,
      );
    default:
      return 0;
  }
}

function naturalWidth(spec: CardSpec): number {
  return Math.max(
    0,
    textWidth(spec.subtitle ?? ""),
    textWidth(spec.footer ?? ""),
    ...spec.sections.map(sectionWidth),
  );
}

function textLines(
  ctx: RenderContext,
  text: string,
  width: number,
  attributes?: number,
): TextRenderable[] {
  return text.split("\n").map((line) =>
    new TextRenderable(ctx, {
      content: line.length > 0 ? line : " ",
      width,
      height: "auto",
      wrapMode: "word",
      ...(attributes !== undefined ? { attributes } : {}),
    }),
  );
}

function markdownRenderable(ctx: RenderContext, content: string, width: number): MarkdownRenderable {
  return new MarkdownRenderable(ctx, {
    content,
    syntaxStyle: SyntaxStyle.create(),
    width,
    height: "auto",
    conceal: true,
    tableOptions: { widthMode: "full", style: "grid", wrapMode: "word" },
    renderNode: (token, renderContext) => {
      if (token.type !== "heading") return renderContext.defaultRender();
      return new TextRenderable(ctx, {
        content: token.text,
        width,
        height: "auto",
        wrapMode: "word",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
      });
    },
  });
}

function sectionRenderables(
  ctx: RenderContext,
  section: CardSection,
  width: number,
): RenderableLike[] {
  switch (section.kind) {
    case "heading":
      return textLines(ctx, section.text, width, TextAttributes.BOLD);
    case "text":
      return textLines(ctx, section.text, width);
    case "keyValues":
      return textLines(
        ctx,
        section.items.map((item) => `${item.key}: ${item.value}`).join("\n"),
        width,
      );
    case "markdown":
      return [markdownRenderable(ctx, section.content, width)];
    case "table": {
      const content = [
        section.columns.map((header) => [chunk(header, TextAttributes.BOLD)] as TextChunk[]),
        ...section.rows.map((row) =>
          row.map((cell, index) => {
            const value = String(cell);
            return [chunk(section.aligns?.[index] === "right" ? value.padStart(12) : value)] as TextChunk[];
          }),
        ),
      ];
      return [
        new TextTableRenderable(ctx, {
          content,
          width,
          height: "auto",
          columnWidthMode: "full",
          wrapMode: "word",
          showBorders: true,
          border: true,
          borderStyle: "rounded",
          cellPaddingX: 1,
        }),
      ];
    }
    case "gauge":
      return textLines(
        ctx,
        `${section.label} ${bar(section.ratio)}${section.detail ? `  ${section.detail}` : ""}`,
        width,
      );
    case "progress":
      return textLines(
        ctx,
        `${section.label} ${bar(section.ratio)}  ${Math.round(section.ratio * 100)}%`,
        width,
      );
    default:
      return [];
  }
}

type RenderableLike = BoxRenderable | TextRenderable | MarkdownRenderable | TextTableRenderable;

export function buildCard(ctx: RenderContext, spec: CardSpec, availableWidth = 80): BoxRenderable {
  const available = Math.max(24, Math.floor(availableWidth));
  const cardWidth = Math.min(available, Math.max(MIN_CARD_WIDTH, naturalWidth(spec) + 4));
  const contentWidth = Math.max(16, cardWidth - 4);

  const card = new BoxRenderable(ctx, {
    width: cardWidth,
    height: "auto",
    alignSelf: "flex-start",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    border: true,
    borderStyle: "rounded",
    title: ` ${spec.title} `,
  });

  if (spec.subtitle) {
    for (const line of textLines(ctx, spec.subtitle, contentWidth)) card.add(line);
    card.add(new TextRenderable(ctx, { content: " ", height: 1, width: "auto" }));
  }

  for (const section of spec.sections) {
    for (const renderable of sectionRenderables(ctx, section, contentWidth)) card.add(renderable);
  }

  if (spec.footer) {
    card.add(new TextRenderable(ctx, { content: " ", height: 1, width: "auto" }));
    for (const line of textLines(ctx, spec.footer, contentWidth)) card.add(line);
  }

  return card;
}

export async function writeCard(renderer: CliRenderer, spec: CardSpec): Promise<void> {
  const surface = renderer.createScrollbackSurface({ startOnNewLine: true });
  const card = buildCard(renderer, spec, Math.max(24, (surface.width || 80) - 1));
  surface.root.add(card);
  surface.render();
  await surface.settle();
  surface.commitRows(0, surface.height, { trailingNewline: true });
  surface.destroy();
  await renderer.idle();
  await new Promise((resolve) => setTimeout(resolve, 150));
}

export function plainCard(spec: CardSpec): string {
  const lines: string[] = [spec.title];
  if (spec.subtitle) {
    lines.push(spec.subtitle, "");
  }
  for (const section of spec.sections) {
    switch (section.kind) {
      case "heading":
      case "text":
        lines.push(section.text);
        break;
      case "keyValues":
        for (const item of section.items) lines.push(`${item.key}: ${item.value}`);
        break;
      case "markdown":
        lines.push(section.content);
        break;
      case "table": {
        const widths = section.columns.map((column, index) =>
          Math.max(column.length, ...section.rows.map((row) => String(row[index] ?? "").length)),
        );
        const rowText = (cells: (string | number)[]) =>
          cells
            .map((cell, index) => String(cell ?? "").padEnd(widths[index] ?? 0))
            .join("  ")
            .trimEnd();
        lines.push(rowText(section.columns));
        lines.push(widths.map((width) => "-".repeat(width)).join("  "));
        for (const row of section.rows) lines.push(rowText(row));
        break;
      }
      case "gauge":
        lines.push(
          `${section.label}: ${Math.round(section.ratio * 100)}%${section.detail ? ` (${section.detail})` : ""}`,
        );
        break;
      case "progress":
        lines.push(`${section.label}: ${Math.round(section.ratio * 100)}%`);
        break;
    }
    lines.push("");
  }
  if (spec.footer) lines.push(spec.footer);
  return lines.join("\n").trimEnd();
}
