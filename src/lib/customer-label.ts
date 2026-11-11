/**
 * Shoppers are anonymous, so the owner tells them apart by a short label made from the conversation
 * id. The same conversation gets the same label on every page and forever, whatever the list order.
 */

/**
 * A short, stable label for an anonymous customer.
 *
 * @param conversationId - The conversation's id
 * @returns A label such as "Customer 4F2A"
 */
export function customerLabel(conversationId: string): string {
  // FNV-1a: small, fast and well spread; four base-36 characters give 1.6 million labels.
  let hash = 0x811c9dc5;
  for (let index = 0; index < conversationId.length; index += 1) {
    hash ^= conversationId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `Customer ${(hash % 36 ** 4).toString(36).toUpperCase().padStart(4, "0")}`;
}
