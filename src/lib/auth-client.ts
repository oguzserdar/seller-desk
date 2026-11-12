import { createAuthClient } from "better-auth/react";

/** Better Auth's browser client for this installation (same origin, /api/auth). */
export const authClient = createAuthClient();
