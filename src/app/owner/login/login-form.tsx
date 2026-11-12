"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { connectorResumeUrl } from "@/lib/connector-resume";
import { authClient } from "@/lib/auth-client";

/**
 * Password sign-in with Better Auth's browser client, then a full page load, so the desk starts from the new
 * session. No Server Action sets the session cookie: on vinext that surfaced as a failed sign-in after
 * the session was already made. Better Auth's own rate limit guards /sign-in/email (options.ts), and every
 * desk request still checks that the signed-in user owns this shop (readOwner).
 */
export function LoginForm() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!email || !password) { setError("Enter your email and password."); return; }
    setError(null);
    setPending(true);
    let failed: { status?: number } | null;
    try {
      ({ error: failed } = await authClient.signIn.email({ email, password }));
    } catch {
      // A dropped connection rejects instead of returning an error; free the button so the owner can retry.
      setError("The shop could not be reached. Check your connection and try again.");
      setPending(false);
      return;
    }
    if (!failed) {
      // Opened by an AI app asking for access: carry on to its consent page instead of the desk.
      window.location.assign(connectorResumeUrl(window.location.search) ?? "/owner/orders");
      return; // the button stays busy until the page leaves
    }
    setError(failed?.status === 429 ? "Too many attempts. Wait a minute and try again." : "That email or password is not correct.");
    setPending(false);
  }

  return (
    <form method="post" className="mt-8 flex flex-col gap-4" onSubmit={submit}>
      <Input label="Email" id="email" name="email" type="email" autoComplete="username" required maxLength={200} />
      <Input label="Password" id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      {error ? <Alert tone="danger" title={error} /> : null}
      <Button type="submit" disabled={!ready || pending} loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
