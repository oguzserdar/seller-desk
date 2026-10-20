"use server";
import { headers } from "next/headers";
import { actionClient } from "@/server/actions/safe-action";
import { FirstOwnerInput, installFirstOwner } from "@/server/auth/first-owner";

/** One-time installation is authorized by its private host token, not public account signup. */
export const createFirstOwnerAction = actionClient.inputSchema(FirstOwnerInput).action(async ({ parsedInput }) => installFirstOwner(parsedInput, await headers()));
