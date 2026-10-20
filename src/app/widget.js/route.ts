/**
 * The one script a merchant adds to their site:
 *   <script src="https://YOUR-DESK/widget.js" async></script>
 * It draws a launcher in an isolated shadow root and opens /widget in a frame.
 * The frame only loads on sites the owner allowed (frame-ancestors), and it
 * talks back with a single close message whose origin is checked.
 */
const SOURCE = String.raw`(() => {
  "use strict";
  if (window.__sellerDeskWidget) return;
  const script = document.currentScript;
  if (!script || !script.src) return;
  const base = new URL(script.src).origin;
  const label = (script.dataset.label || "Ask the shop").slice(0, 40);
  window.__sellerDeskWidget = true;

  const host = document.createElement("div");
  host.setAttribute("data-seller-desk-widget", "");
  const root = host.attachShadow({ mode: "open" });
  const ease = "cubic-bezier(0.23, 1, 0.32, 1)";
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    ".launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 20px;border:0;border-radius:999px;background:#0e1217;color:#fff;font:600 15px/1 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;box-shadow:0 1px 2px rgb(22 24 29/.12),0 8px 24px -8px rgb(22 24 29/.4);transition:transform 150ms " + ease + "}" +
    ".launcher:active{transform:scale(.97)}" +
    ".launcher:focus-visible{outline:2px solid #2750a2;outline-offset:3px}" +
    ".panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:min(420px,calc(100vw - 40px));height:min(680px,calc(100vh - 120px));border-radius:16px;overflow:hidden;background:#f6f7f9;box-shadow:0 0 0 1px rgb(22 24 29/.08),0 24px 64px -16px rgb(22 24 29/.35);transform-origin:bottom right;visibility:hidden;opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity 200ms " + ease + ",transform 200ms " + ease + ",visibility 0s linear 200ms}" +
    ".panel[data-open]{visibility:visible;opacity:1;transform:none;pointer-events:auto;transition:opacity 200ms " + ease + ",transform 200ms " + ease + ",visibility 0s}" +
    "iframe{display:block;width:100%;height:100%;border:0}" +
    "@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}.panel[data-open]~.launcher{display:none}}" +
    "@media (prefers-reduced-motion:reduce){.launcher,.panel,.panel[data-open]{transition:none}}" +
    "</style>" +
    "<div class='panel' role='dialog' aria-label='Shop assistant'><iframe title='Shop assistant' allow='clipboard-write'></iframe></div>" +
    "<button type='button' class='launcher' aria-expanded='false'></button>";
  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const frame = root.querySelector("iframe");
  launcher.textContent = label;

  const load = () => {
    if (!frame.getAttribute("src")) frame.setAttribute("src", base + "/widget");
  };
  const open = () => {
    load();
    panel.setAttribute("data-open", "");
    launcher.setAttribute("aria-expanded", "true");
    frame.focus();
  };
  const close = () => {
    if (!panel.hasAttribute("data-open")) return;
    panel.removeAttribute("data-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  };

  launcher.addEventListener("pointerenter", load, { once: true });
  launcher.addEventListener("focus", load, { once: true });
  launcher.addEventListener("click", () => (panel.hasAttribute("data-open") ? close() : open()));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  window.addEventListener("message", (event) => {
    if (event.origin === base && event.source === frame.contentWindow && event.data && event.data.type === "seller-desk:close") close();
  });
  fetch(base + "/api/widget/allowed", { credentials: "omit" })
    .then((response) => response.json())
    .then((answer) => {
      if (answer && answer.allowed === true) (document.body || document.documentElement).appendChild(host);
      else console.warn("Seller Desk: " + location.origin + " is not one of this shop's allowed websites, so the shop assistant stays hidden. The owner can add it under Setup.");
    })
    .catch(() => {});
})();
`;

export function GET(): Response {
  return new Response(SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
