/**
 * A drafted reply leaves [bracketed blanks] where the shop's facts are missing. The owner fills them in;
 * until then the reply must not reach a customer.
 */

/**
 * True when the text still holds a [bracketed blank] to fill in.
 *
 * @param text - The owner's answer as it stands in the box
 * @returns Whether any non-empty [ ... ] blank remains
 */
export function hasBlanks(text: string): boolean {
  return /\[[^\[\]\n]+\]/.test(text);
}
