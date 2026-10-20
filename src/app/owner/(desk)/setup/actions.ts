"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { DESK_THEME_COOKIE, DESK_THEME_IDS } from "@/lib/desk-themes";
import { ownerAction } from "@/server/actions/safe-action";
import { verifyAiSetup } from "@/server/ai/setup-check";
import { requireUsage } from "@/server/domain/usage";
import { recordModelCheck } from "@/server/domain/model-check";
import { AiConnectionInput, removeAiConnection, saveAiConnection } from "@/server/domain/ai-settings";
import { SellerProfileInput, updateSellerProfile } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";
import { checkPayPalConnection } from "@/server/paypal/connection-check";

export const updateProfileAction = ownerAction.inputSchema(SellerProfileInput).action(async ({ parsedInput, ctx }) => {
  const updated = await updateSellerProfile(ctx.owner, parsedInput);
  revalidatePath("/", "layout");
  return { policyRevision: updated.policyRevision, termsChanged: updated.policyRevision !== parsedInput.expectedPolicyRevision };
});

export const checkModelAction = ownerAction.action(async ({ ctx }) => {
  await requireUsage("ai_setup_check", ctx.owner.userId, 600, 6, "Wait before checking the AI connections again.");
  const result = await verifyAiSetup();
  await recordModelCheck(ctx.owner, result);
  revalidatePath("/owner", "layout");
  return result.ok ? { ok: true as const, latencyMs: result.latencyMs } : { ok: false as const, problem: result.problem };
});

/** Tests the pasted key with one real model call, then stores it encrypted. The key is never sent back. */
export const saveAiConnectionAction = ownerAction.inputSchema(AiConnectionInput).action(async ({ parsedInput, ctx }) => {
  await requireUsage("ai_connection_save", ctx.owner.userId, 600, 6, "Wait a few minutes before trying another key.");
  const result = await saveAiConnection(ctx.owner, parsedInput);
  if (result.ok) revalidatePath("/owner", "layout");
  return result;
});

/** Deletes the saved key; host settings apply again. */
export const removeAiConnectionAction = ownerAction.action(async ({ ctx }) => {
  await removeAiConnection(ctx.owner);
  revalidatePath("/owner", "layout");
  return { ok: true as const };
});

/** Owner-only diagnostic; credentials and the destination come from trusted server configuration. */
export const checkPayPalAction = ownerAction.action(async () => {
  const config = getServerConfig();
  return checkPayPalConnection(config.paypal, config.appUrl);
});

/** A display preference for this browser, like a theme in any desk app; it changes no shop data. */
export const setDeskThemeAction = ownerAction.inputSchema(z.object({ theme: z.enum(DESK_THEME_IDS) })).action(async ({ parsedInput }) => {
  (await cookies()).set(DESK_THEME_COOKIE, parsedInput.theme, { path: "/owner", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/owner", "layout");
  return { theme: parsedInput.theme };
});
