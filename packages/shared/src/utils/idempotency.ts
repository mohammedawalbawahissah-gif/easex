/**
 * A fresh key for ONE submission of a money-moving form. Generate it when
 * the form opens (or after a success), and re-use it for retries of that
 * same submission — the server then treats a double-tap or a retry after a
 * dropped connection as the same request instead of paying twice.
 *
 * Uses crypto.randomUUID() where it exists (browsers, modern Hermes) and
 * falls back to a random hex string. Not a secret — only needs to be unique.
 */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return `${hex()}${hex()}${hex()}${hex()}`;
}
