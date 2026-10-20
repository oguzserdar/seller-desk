/** @fileoverview Form hints remain plain, singly rendered text linked to their controls. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Input } from "../../src/components/arc/input/input";
import { Textarea } from "../../src/components/arc/textarea/textarea";
it.each([Input, Textarea])(
  "renders one readable hint without duplicate animated words",
  (Control) => {
    const html = renderToStaticMarkup(
      createElement(Control as typeof Input, {
        label: "Quantity",
        id: "quantity",
        description: "Maximum per checkout.",
        error: "Enter a valid number.",
        "aria-describedby": "external",
      }),
    );
    expect(html.match(/Maximum per checkout\./g)).toHaveLength(1);
    expect(html.match(/Enter a valid number\./g)).toHaveLength(1);
    expect(html).toContain(
      'aria-describedby="external quantity-description quantity-error"',
    );
    expect(html).toContain('role="alert"');
  },
);
