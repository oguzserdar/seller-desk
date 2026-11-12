/**
 * A drafted reply leaves [[double-bracketed blanks]] where the shop's facts are missing, so ordinary
 * brackets an owner types (links, codes, [sic]) never block sending. The owner fills them in;
 * until then the reply must not reach a customer.
 */

/**
 * True when the text still holds a [[blank]] to fill in.
 *
 * @param text - The owner's answer as it stands in the box
 * @returns Whether any non-empty [[ ... ]] blank remains
 */
export function hasBlanks(text: string): boolean {
  return /\[\[[^\[\]\n]+\]\]/.test(text);
}
