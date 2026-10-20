import { Button } from "@/components/shadcn/button";

const SECTIONS = [
  ["overview", "Overview"],
  ["assistant", "Assistant"],
  ["paypal", "PayPal"],
  ["desk-theme", "Desk theme"],
  ["shop", "Shop"],
  ["shop-colours", "Shop colours"],
  ["terms", "Terms"],
  ["widget", "Websites"],
  ["usage-limits", "Limits"],
] as const;

/** Native section anchors styled by the existing library; all settings remain on this page. */
export function SetupNavigation() {
  return (
    <nav
      aria-label="Setup sections"
      className="sticky top-0 z-20 -mx-1 mt-5 mb-6 flex flex-wrap gap-1 border-b border-line bg-canvas px-1 py-3"
    >
      {SECTIONS.map(([id, label]) => (
        <Button key={id} variant="ghost" size="sm" asChild>
          <a href={`#${id}`}>{label}</a>
        </Button>
      ))}
    </nav>
  );
}
