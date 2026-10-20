/** @fileoverview Alert details may contain actions and block content without invalid paragraph nesting. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Alert } from "../../src/components/arc/alert/alert";
it("keeps action groups out of paragraph elements", () => {
  const html = renderToStaticMarkup(
    createElement(
      Alert,
      { title: "Confirm" },
      createElement("div", null, createElement("button", null, "Keep")),
    ),
  );
  expect(html).not.toMatch(/<p[^>]*>\s*<div/);
  expect(html).toContain("Keep");
});
