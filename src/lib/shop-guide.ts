import { z } from "zod";

/** Topics organize public shop knowledge without restricting the kind of seller. */
export const GUIDE_TOPICS = ["shipping", "returns", "options", "booking", "subscriptions", "downloads", "general"] as const;
/** Plain labels shared by the owner editor and buyer source cards. */
export const GUIDE_LABELS: Record<(typeof GUIDE_TOPICS)[number], string> = {
  shipping: "Shipping", returns: "Returns & exchanges", options: "Product options", booking: "Appointments",
  subscriptions: "Subscriptions", downloads: "Digital delivery", general: "About the shop",
};
/** Maximum number of entries read together, including drafts in the editor. */
export const GUIDE_LIMIT = 24;

/** Normalizes a public HTTPS destination; this value is never fetched by the server. */
export function publicShopUrl(value: string): string | null {
  try {
    if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) return null;
    if (/\.(?:localhost|local|internal|lan|home|test|invalid)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

/** Owner-authored public facts and an optional public destination, never executable instructions. */
export const GuideInput = z.object({
  id: z.uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  title: z.string().trim().min(3).max(100), topic: z.enum(GUIDE_TOPICS),
  body: z.string().trim().min(10).max(2000), published: z.boolean(),
  productId: z.uuid().nullable(), validUntil: z.iso.datetime({ offset: true }).nullable(),
  actionLabel: z.string().trim().max(60), actionUrl: z.string().trim().max(1500),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.id) !== Boolean(value.expectedRevision)) ctx.addIssue({ code: "custom", message: "Reload this entry before saving." });
  if (Boolean(value.actionLabel) !== Boolean(value.actionUrl)) ctx.addIssue({ code: "custom", message: "Give the link both a label and a destination." });
  if (value.actionUrl && !publicShopUrl(value.actionUrl)) ctx.addIssue({ code: "custom", message: "Use a public HTTPS page with no login credentials in its address." });
});
/** Values posted by the owner form. */
export type GuideInput = z.infer<typeof GuideInput>;
/** Complete immutable knowledge version, private to the owner until explicitly published. */
export type GuideSnapshot = Omit<GuideInput, "id" | "expectedRevision"> & { archived: boolean };
/** Browser-safe version history with no customer source context. */
export type GuideHistoryItem = { revision: number; savedAt: string; snapshot: GuideSnapshot };
/** Public source facts read by the AI; all content is intentionally buyer-visible. */
export type GuideSource = { id: string; revision: number; title: string; topic: (typeof GUIDE_TOPICS)[number]; body: string; updatedAt: string; hasNextStep: boolean; productId: string | null; validUntil: string | null };
/** A server-resolved next step. A visit is never evidence that an outside action completed. */
export type ShopStep = { id: string; revision: number; title: string; label: string; host: string };
