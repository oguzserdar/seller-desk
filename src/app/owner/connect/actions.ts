"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireOwner } from "@/server/auth/owner";
import { actionClient } from "@/server/actions/safe-action";
import { answerConsent } from "@/server/connector/consent";
import { DomainError } from "@/server/domain/errors";

const ConsentInput = z.object({ accept: z.boolean(), oauthQuery: z.string().min(1).max(8000) }).strict();

/**
 * Records the owner's answer to an AI app's access request and returns where the browser goes next:
 * back to the AI app with a code (allowed) or with an access_denied error (denied).
 */
export const answerConnector = actionClient.inputSchema(ConsentInput).action(async ({ parsedInput }) => {
  const requestHeaders = await headers();
  await requireOwner(requestHeaders);
  try {
    return { redirectTo: await answerConsent(requestHeaders, parsedInput.accept, parsedInput.oauthQuery) };
  } catch (error) {
    throw new DomainError("expired", error instanceof Error ? error.message : "Start the connection again from the AI app.");
  }
});
