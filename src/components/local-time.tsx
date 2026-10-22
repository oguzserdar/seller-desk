"use client";

import { useEffect, useState } from "react";

/**
 * A time shown in the viewer's own time zone. Server-rendered pages run in UTC,
 * so the server sends the exact instant with a fallback labelled UTC, and the
 * browser replaces it with local time after loading, as GitHub's relative-time
 * element does. The fallback is never an unlabelled UTC time.
 */
export function LocalTime({ value, options }: { value: Date | string; options: Intl.DateTimeFormatOptions }) {
  const iso = new Date(value).toISOString();
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(new Intl.DateTimeFormat(undefined, options).format(new Date(iso))), [iso, options]);
  return (
    <time dateTime={iso}>
      {local ?? `${new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(iso))} UTC`}
    </time>
  );
}
