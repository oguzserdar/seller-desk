"use client";

/**
 * Browser side of the buyer capability. The token lives in this tab's
 * sessionStorage when the browser allows it, otherwise only in memory for this
 * tab (blocked third-party storage). It is sent as a Bearer header and never
 * placed in a URL, cookie or analytics call.
 */
import { useCallback, useEffect, useState } from "react";

export type Envelope<T> = {
  requestId: string;
  state: string;
  message: string;
  next: string[];
  data: T | null;
  httpStatus: number;
};

export type StorageMode = "session" | "memory";
type Stored = { token: string; expiresAt: string };

const KEY = "seller-desk.buyer";
let memory: Stored | null = null;

// localStorage, not sessionStorage: the customer can close the tab and come back to the same chat
// (the server keeps the session for 7 days). "End chat" removes it.
function storage(): Storage | null {
  try {
    const store = window.localStorage;
    const probe = "seller-desk.probe";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readToken(): Stored | null {
  const store = storage();
  let value: Stored | null = memory;
  if (store) {
    try {
      let raw = store.getItem(KEY);
      if (!raw) {
        // Saved by the previous version in this tab's sessionStorage: move it so an open chat or checkout survives the deploy.
        raw = window.sessionStorage.getItem(KEY);
        if (raw) { store.setItem(KEY, raw); window.sessionStorage.removeItem(KEY); }
      }
      value = raw ? (JSON.parse(raw) as Stored) : memory;
    } catch {
      value = memory;
    }
  }
  if (!value || Date.parse(value.expiresAt) <= Date.now()) return null;
  return value;
}

export function saveToken(value: Stored): StorageMode {
  memory = value;
  const store = storage();
  if (!store) return "memory";
  try {
    store.setItem(KEY, JSON.stringify(value));
    return "session";
  } catch {
    return "memory";
  }
}

export function clearToken(): void {
  memory = null;
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing persisted
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Envelope<T>> {
  const token = readToken()?.token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, cache: "no-store" });
  } catch {
    return { requestId: "", state: "network", message: "The shop could not be reached. Check your connection and try again.", next: ["retry"], data: null, httpStatus: 0 };
  }
  const body = (await response.json().catch(() => null)) as Omit<Envelope<T>, "httpStatus"> | null;
  if (!body) {
    return { requestId: "", state: "error", message: "The shop sent an unexpected reply. Try again.", next: ["retry"], data: null, httpStatus: response.status };
  }
  return { ...body, httpStatus: response.status };
}

export type BuyerSessionState =
  | { status: "starting" }
  | { status: "ready"; mode: StorageMode }
  | { status: "error"; message: string };

type SessionResult = Envelope<{ token: string; expiresAt: string }>;
// One session request per tab at a time. React may run the start effect twice
// (development StrictMode), and two sessions would split the page: it would load
// one conversation while later requests use the other.
let starting: Promise<SessionResult> | null = null;

function createSession(entry: "page" | "widget"): Promise<SessionResult> {
  starting ??= (async () => {
    clearToken();
    const result = await api<{ token: string; expiresAt: string }>("/api/buyer/session", { method: "POST", json: { entry } });
    if (result.data) saveToken(result.data);
    return result;
  })().finally(() => { starting = null; });
  return starting;
}

/** Ensures this tab has a buyer capability, starting a session if needed. */
export function useBuyerSession(entry: "page" | "widget", options: { autoStart?: boolean } = {}) {
  const autoStart = options.autoStart ?? true;
  const [state, setState] = useState<BuyerSessionState>({ status: "starting" });

  const start = useCallback(async () => {
    setState({ status: "starting" });
    const result = await createSession(entry);
    if (!result.data) {
      setState({ status: "error", message: result.message });
      return;
    }
    setState({ status: "ready", mode: storage() ? "session" : "memory" });
  }, [entry]);

  useEffect(() => {
    const existing = readToken();
    if (existing) {
      setState({ status: "ready", mode: storage() ? "session" : "memory" });
      return;
    }
    if (autoStart) void start();
    else setState({ status: "error", message: "Your chat session is not available in this tab." });
  }, [autoStart, start]);

  return { state, restart: start };
}

/** Reads `#name=value` from the fragment and removes it from the address bar. */
export function takeFragmentParam(name: string): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const value = params.get(name);
  if (value) {
    params.delete(name);
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`);
  }
  return value;
}
