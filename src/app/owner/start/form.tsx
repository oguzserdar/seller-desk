"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { createFirstOwnerAction } from "./actions";

/** Uses the established Arc controls; secrets stay in POST state and are cleared after installation. */
export function FirstOwnerForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setName] = useState("");
  const [country, setCountry] = useState("CA");
  const [currency, setCurrency] = useState("CAD");
  const action = useAction(createFirstOwnerAction, { onSuccess: ({ data }) => { if (data?.created) { setToken(""); setPassword(""); router.replace("/owner/login"); router.refresh(); } } });
  return <form method="post" className="mt-8 space-y-5" onSubmit={event => { event.preventDefault(); action.execute({ token, email, password, displayName, country, currency }); }}>
    <Input label="Installation token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} required minLength={32} maxLength={256} disabled={action.isPending} description="The INSTALL_TOKEN you set on your host. This is separate from your account password." />
    <Input label="Shop name" value={displayName} onChange={e => setName(e.target.value)} required maxLength={80} disabled={action.isPending} />
    <Input label="Your email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required maxLength={200} disabled={action.isPending} />
    <Input label="Create a password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={action.isPending} description="Use at least 12 characters." />
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Country code" value={country} onChange={e => setCountry(e.target.value.toUpperCase())} required pattern="[A-Z]{2}" maxLength={2} disabled={action.isPending} description="Two letters, such as CA or US." /><Select label="Shop currency" value={currency} onValueChange={setCurrency} options={SUPPORTED_CURRENCIES.map(value => ({ value, label: value }))} disabled={action.isPending} /></div>
    {action.result.serverError || action.result.validationErrors ? <Alert tone="warning" title={action.result.serverError ?? "Check each field and try again."} /> : null}
    <Button type="submit" loading={action.isPending} disabled={!ready || action.isPending}>Create your desk</Button>
    <p className="text-ink-3 text-[13px] leading-relaxed">Once the owner exists, this setup closes automatically. Remove INSTALL_TOKEN from your host settings afterward.</p>
  </form>;
}
