/** Small, pure string helpers. */

/**
 * First two alphanumeric characters of a name, ignoring spaces and punctuation
 * (so "Eduardo - A" -> "ED", "john_doe" -> "JO"). Falls back to "?".
 */
export function initialsOf(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}

/** A NUL byte is a reliable "this is binary" signal for text we tried to decode. */
export function hasNullByte(text: string): boolean {
  return text.includes("\u0000");
}
