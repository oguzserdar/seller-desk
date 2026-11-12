"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { DESK_THEME_COOKIE, DESK_THEME_IDS } from "@/lib/desk-themes";
import { ownerAction } from "@/server/actions/safe-action";
import { removeApp } from "@/server/connector/access";
import { setAssistantDraftsAnswers, setConnectorMayAnswer } from "@/server/domain/connector-settings";
import { verifyAiSetup } from "@/server/ai/setup-check";
import { requireUsage } from "@/server/domain/usage";
import { recordModelCheck } from "@/server/domain/model-check";
import { AiConnectionInput, removeAiConnection, saveAiConnection } from "@/server/domain/ai-settings";
import { listProviderModels } from "@/server/ai/provider-models";
import { getEffectiveConfig } from "@/server/effective-config";
import { AI_PROVIDERS } from "@/server/env";
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

/**
 * Lists the provider's chat models for the pasted key, or for the connected key
 * when none is pasted. The key is used for this one request and not stored.
 */
export const listAiModelsAction = ownerAction
  .inputSchema(z.object({ provider: z.enum(AI_PROVIDERS), apiKey: AiConnectionInput.shape.apiKey.optional() }))
  .action(async ({ parsedInput, ctx }) => {
    await requireUsage("ai_model_list", ctx.owner.userId, 600, 20, "Wait a few minutes before loading models again.");
    let apiKey = parsedInput.apiKey;
    if (!apiKey) {
      const ai = (await getEffectiveConfig()).ai;
      if (ai.status === "ready" && ai.provider === parsedInput.provider && ai.apiKey) apiKey = ai.apiKey;
    }
    if (!apiKey) return { ok: false as const, problem: "Paste a key first." };
    return listProviderModels(parsedInput.provider, apiKey);
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

/** Removes one AI app the owner connected, with its tokens; its next call is refused. */
export const removeAiAppAction = ownerAction.inputSchema(z.object({ consentId: z.string().min(1).max(100) }).strict()).action(async ({ parsedInput, ctx }) => {
  const removed = await removeApp(ctx.owner.userId, parsedInput.consentId);
  revalidatePath("/owner/setup");
  return { removed };
});

/** Lets connected AI apps answer customers' waiting questions as the owner, or stops them. */
export const setConnectorAnswersAction = ownerAction.inputSchema(z.object({ allowed: z.boolean() }).strict()).action(async ({ parsedInput, ctx }) => {
  await setConnectorMayAnswer(ctx.owner, parsedInput.allowed);
  revalidatePath("/owner/setup");
  return { allowed: parsedInput.allowed };
});

/** Chooses between "only I answer" and "my assistant drafts, I approve". */
export const setAssistantDraftsAction = ownerAction.inputSchema(z.object({ on: z.boolean() }).strict()).action(async ({ parsedInput, ctx }) => {
  await setAssistantDraftsAnswers(ctx.owner, parsedInput.on);
  revalidatePath("/owner/setup");
  revalidatePath("/owner/orders");
  return { on: parsedInput.on };
});
