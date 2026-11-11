/**
 * Identifier helpers. All entity IDs are UUIDv7 so that they sort by creation
 * time; network namespace and interface names derive short stable prefixes
 * from them.
 */

export function newId(): string {
  return Bun.randomUUIDv7();
}

/** First 10 hex characters of a UUID, dashes removed. Fits Linux name budgets. */
export function shortHex(id: string, length = 10): string {
  return id.replaceAll('-', '').slice(0, length);
}

/** Project network namespace name: `nb-` plus 10 hex characters (<= 15 chars). */
export function netnsName(projectId: string): string {
  return `nb-${shortHex(projectId)}`;
}

/** Deterministic interface suffix for an anchor: sha256(owner:adapter:port)[0..10]. */
export function anchorHash(ownerId: string, adapter: number, port: number): string {
  return shortHex(
    new Bun.CryptoHasher('sha256').update(`${ownerId}:${adapter}:${port}`).digest('hex'),
    10,
  );
}
