Vendored from Arc (github.com/kuratlielia/arc-library), MIT, commit 55c0d3ebd7cc643ec118c4d8a11413e6fadcc7df, read 13 Oct 2026. Licence: ./LICENSE.

Use the actual package components, not custom replacements. Button, input and textarea visuals were restored from this commit. Import paths resolve locally. The button preserves the reproduced aria-disabled click guard. Field wrappers have width100% and align-self:start to prevent parent stretch; no new visual language was added. UserMenu accepts an optional theme portal container. Alert details use a div rather than a paragraph because its documented ReactNode children include block actions. Existing Select/model menu theme containment and count layout fixes remain.

registry/blocks/page-header and registry/blocks/empty-states were added from the same commit on14Oct2026. These are upstream demos, not generic data-driven product components; do not expose their fictional example records as shop data.

The owner navigation uses the official shadcn Sidebar because the pinned and current Arc registry has no sidebar. See ../shadcn/README.md and docs/ui-sources.md.

ChatComposer accepts optional native maxLength, ariaLabel and autoFocus attributes; upstream composer CSS is unchanged. BottomSheet accepts a palette portal container and restores focus for externally opened controlled sheets. Its geometry, gesture handling and visual classes remain upstream. Buyer product cards use actual Card media/title/description/action slots; no private implementation was copied.

RichTextEditor link editing is safe inside an application form: the link row uses a named group rather than a nested form; explicit Enter and Apply link callbacks prevent submission of the containing draft form. Upstream classes and appearance are unchanged. This was reproduced in the actual browser and a regression test failed before the correction.
