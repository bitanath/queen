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
};

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

function textLines(ctx: RenderContext, text: string, attributes?: number): TextRenderable[] {
  return text.split("\n").map((line) =>
    new TextRenderable(ctx, {
      content: line.length > 0 ? line : " ",
      width: "auto",
      height: 1,
      wrapMode: "none",
      ...(attributes !== undefined ? { attributes } : {}),
    }),
  );
}

function sectionRenderables(ctx: RenderContext, section: CardSection): RenderableLike[] {
  switch (section.kind) {
    case "heading":
      return textLines(ctx, section.text, TextAttributes.BOLD);
    case "text":
      return textLines(ctx, section.text);
    case "keyValues":
      return textLines(ctx, section.items.map((item) => `${item.key}: ${item.value}`).join("\n"));
    case "markdown":
      return [
        new MarkdownRenderable(ctx, {
          content: section.content,
          syntaxStyle: SyntaxStyle.create(),
          width: "auto",
          height: "auto",
          conceal: true,
          tableOptions: { widthMode: "content", style: "grid" },
        }),
      ];
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
          width: "auto",
          height: "auto",
          columnWidthMode: "content",
          showBorders: true,
          border: true,
          borderStyle: "rounded",
          cellPaddingX: 1,
        }),
      ];
    }
    case "gauge":
      return textLines(ctx, `${section.label} ${bar(section.ratio)}${section.detail ? `  ${section.detail}` : ""}`);
    case "progress":
      return textLines(ctx, `${section.label} ${bar(section.ratio)}  ${Math.round(section.ratio * 100)}%`);
    default:
      return [];
  }
}

type RenderableLike = BoxRenderable | TextRenderable | MarkdownRenderable | TextTableRenderable;

export function buildCard(ctx: RenderContext, spec: CardSpec): BoxRenderable {
  const card = new BoxRenderable(ctx, {
    width: "auto",
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
    for (const line of textLines(ctx, spec.subtitle)) card.add(line);
    card.add(new TextRenderable(ctx, { content: " ", height: 1, width: "auto" }));
  }

  for (const section of spec.sections) {
    for (const renderable of sectionRenderables(ctx, section)) card.add(renderable);
  }

  if (spec.footer) {
    card.add(new TextRenderable(ctx, { content: " ", height: 1, width: "auto" }));
    for (const line of textLines(ctx, spec.footer)) card.add(line);
  }

  return card;
}

export async function writeCard(renderer: CliRenderer, spec: CardSpec): Promise<void> {
  const surface = renderer.createScrollbackSurface({ startOnNewLine: true });
  const card = buildCard(renderer, spec);
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
