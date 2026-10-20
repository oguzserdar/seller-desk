import { getStorage } from "@/server/storage";
import type { PaidCommitInput, PaidOutcome } from "@/server/storage/payments";

export type { PaidOutcome } from "@/server/storage/payments";

/** Atomically records verified evidence through the selected installation backend. */
export async function recordPaidOrder(
  input: PaidCommitInput,
): Promise<PaidOutcome> {
  return getStorage().payments.recordPaidOrder(input);
}
