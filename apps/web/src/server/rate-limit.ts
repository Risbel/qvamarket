/**
 * Sliding-window rate limiter kept in memory (one process).
 *
 * Good enough for a single VPS; it resets when the server restarts. When the app runs as
 * several instances, move the counters to a shared store (Redis/PostgreSQL) behind this
 * same interface.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let calls = 0;

  function recent(key: string, now: number) {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length === 0) hits.delete(key);
    else hits.set(key, list);
    return list;
  }

  function sweep(now: number) {
    // Forget keys that have no recent hits so the map cannot grow without bound
    if (++calls % 500 !== 0) return;
    for (const key of [...hits.keys()]) recent(key, now);
  }

  return {
    /** Counts a hit. false = over the limit (the hit is not counted). */
    tryConsume(key: string): boolean {
      const now = Date.now();
      sweep(now);
      const list = recent(key, now);
      if (list.length >= limit) return false;
      hits.set(key, [...list, now]);
      return true;
    },
    /** Is the key already at the limit? (does not count) */
    isFull(key: string): boolean {
      return recent(key, Date.now()).length >= limit;
    },
    /** Counts a hit without checking. */
    record(key: string): void {
      const now = Date.now();
      hits.set(key, [...recent(key, now), now]);
    },
  };
}
