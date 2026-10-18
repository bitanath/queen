/* @jsxImportSource @opentui/react */
import { TextAttributes, TextRenderable, type Renderable, type SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useMemo } from "react";

import { useTheme } from "../theme/use-theme";

type HeadingToken = { type?: string; text?: string; depth?: number };

type RenderNode = (
  token: HeadingToken,
  ctx: { defaultRender: () => Renderable | null },
) => Renderable | null | undefined;

export interface MarkdownProps {
  content: string;
  syntaxStyle: SyntaxStyle;
  streaming?: boolean;
} //HACK shimmy shimmy around the actual opentui markdown to ensure headings render correctly and such

export function Markdown({ content, syntaxStyle, streaming = false }: MarkdownProps) {
  const renderer = useRenderer();
  const theme = useTheme();

  const renderNode = useMemo<RenderNode>(
    () => (token, ctx) => {
      if (token.type !== "heading") return ctx.defaultRender();
      const depth = token.depth ?? 1;
      return new TextRenderable(renderer, {
        content: token.text ?? "",
        fg: theme.colors.primary,
        attributes: depth <= 2 ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD,
        width: "auto",
        marginTop: 1,
      });
    },
    [renderer, theme],
  );

  return (
    <markdown
      key={theme.name}
      content={content}
      syntaxStyle={syntaxStyle}
      streaming={streaming}
      renderNode={renderNode}
      tableOptions={{ widthMode: "full", style: "grid" }}
    />
  );
}
