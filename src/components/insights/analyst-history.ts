/**
 * Keeps the Insights analyst's conversations in this browser, through Studio's history store, so a
 * question asked yesterday is still there today. The owner and demo visitors keep separate lists.
 * Storage can be unavailable (private windows, blocked site data); then history lasts the visit.
 */
import type { AgAiHistoryStore, AgAiThread } from "ag-studio";

const MAX_THREADS = 20;

/** A history store backed by localStorage under one key. */
export function browserHistory(key: string): AgAiHistoryStore {
  const listeners = new Set<Parameters<AgAiHistoryStore["addEventListener"]>[1]>();
  let memory: AgAiThread[] = [];
  const read = (): AgAiThread[] => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as AgAiThread[]) : memory;
    } catch {
      return memory;
    }
  };
  const write = (threads: AgAiThread[]) => {
    memory = threads.slice(-MAX_THREADS);
    try {
      window.localStorage.setItem(key, JSON.stringify(memory));
    } catch {
      // Full or blocked storage: keep the visit's history in memory.
    }
    for (const listener of listeners) listener({ type: "changed" });
  };
  return {
    // Studio treats the last summary as the newest conversation.
    listThreads: async () => read().map((thread) => thread.summary),
    loadThread: async (threadId) => read().find((thread) => thread.summary.threadId === threadId),
    saveThread: async (thread) => write([...read().filter((item) => item.summary.threadId !== thread.summary.threadId), thread]),
    deleteThread: async (threadId) => write(read().filter((item) => item.summary.threadId !== threadId)),
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
}
