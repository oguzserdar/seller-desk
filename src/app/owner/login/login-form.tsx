"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { connectorResumeUrl } from "@/lib/connector-resume";
import { signInOwner } from "./actions";

/** Password sign-in through the hydrated action handler, with a POST-only browser fallback. */
export function LoginForm() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  // Navigation runs inside a transition, so the button stays busy until the desk has rendered.
  const [navigating, startNavigation] = useTransition();
  const { execute, isPending, hasSucceeded, result } = useAction(signInOwner, {
    onSuccess: () => {
      // Opened by an AI app asking for access: carry on to its consent page instead of the desk.
      const resume = connectorResumeUrl(window.location.search);
      if (resume) window.location.assign(resume);
      else startNavigation(() => router.replace("/owner/orders"));
    },
  });
  const error = result.serverError ?? (result.validationErrors ? "Enter your email and password." : null);

  return (
    <form
      method="post"
      className="mt-8 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        execute({ email, password });
      }}
    >
      <Input label="Email" id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Password" id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {error ? <Alert tone="danger" title={error} /> : null}
      <Button type="submit" disabled={!ready || hasSucceeded} loading={isPending || navigating || hasSucceeded}>
        Sign in
      </Button>
    </form>
  );
}
