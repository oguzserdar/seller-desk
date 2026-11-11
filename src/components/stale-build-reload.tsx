"use client";

/**
 * After a deploy, a page that was already open can ask for script chunks the new build no longer has.
 * Vite reports that as `vite:preloadError`; the documented fix is to reload so the page picks up the
 * new build. Reloads at most once a minute, so a real outage cannot loop.
 */
import { useEffect } from "react";

const KEY = "seller-desk.stale-build-reload";

/** Whether this page may reload now: not within a minute of the last such reload. */
export function mayReload(now: number, last: string | null): boolean {
  return !last || now - Number(last) > 60_000;
}

/** Mount once in the root layout. Renders nothing. */
export function StaleBuildReload() {
  useEffect(() => {
    const onStale = (event: Event) => {
      let last: string | null = null;
      try {
        last = window.sessionStorage.getItem(KEY);
      } catch {
        // Blocked storage: still reload once; the browser keeps no record to loop on.
      }
      if (!mayReload(Date.now(), last)) return;
      event.preventDefault();
      try {
        window.sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        // Nothing to remember it in.
      }
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onStale);
    return () => window.removeEventListener("vite:preloadError", onStale);
  }, []);
  return null;
}
