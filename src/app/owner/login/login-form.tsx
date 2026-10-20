"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { signInOwner } from "./actions";

/** Password sign-in through the hydrated action handler, with a POST-only browser fallback. */
export function LoginForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { execute, isPending, result } = useAction(signInOwner, {
    onSuccess: () => router.replace("/owner/orders"),
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
      <Button type="submit" disabled={!ready} loading={isPending}>
        Sign in
      </Button>
    </form>
  );
}
