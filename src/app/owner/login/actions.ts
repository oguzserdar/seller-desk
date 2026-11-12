"use server";

import { cookies, headers } from "next/headers";
import { actionClient } from "@/server/actions/safe-action";
import { getAuth } from "@/server/auth/auth";
import { VIEWER_COOKIE } from "@/server/auth/viewer-pass";

export const signOutOwner = actionClient.action(async () => {
  const jar = await cookies();
  // A demo visitor has no session to end, only the pass.
  if (jar.has(VIEWER_COOKIE)) jar.delete(VIEWER_COOKIE);
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Already signed out.
  }
  return { ok: true as const };
});
