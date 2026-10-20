"use client";

/**
 * Adapted from Vercel AI Elements, Apache-2.0. Copyright 2023 Vercel, Inc.
 * Modified: narrow text API, original typography, no plugins, inert links and no remote media.
 * Source pin and license: third-party/ai-elements/NOTICE and LICENSE.
 */
import { memo } from "react";
import { Streamdown, type Components } from "streamdown";

// A model cannot mint a checkout link or load a tracking image. Action links live in tool receipts.
const components: Components = {
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children, start }) => <ol start={start}>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  a: ({ children }) => <span>{children}</span>,
  img: () => null,
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ children }) => <code>{children}</code>,
  table: ({ children }) => <div className="response-table"><table>{children}</table></div>,
};
const allowedElements = ["p", "strong", "em", "del", "ul", "ol", "li", "blockquote", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "a", "table", "thead", "tbody", "tr", "th", "td"];

/** Renders streaming Markdown as safe shop prose, with all commerce actions kept outside model text. */
export const MessageResponse = memo(function MessageResponse({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown className="assistant-prose" mode={streaming ? "streaming" : "static"} isAnimating={streaming} controls={false}
      components={components} allowedElements={allowedElements} skipHtml rehypePlugins={[]}>
      {text}
    </Streamdown>
  );
});
