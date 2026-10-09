/**
 * Best-effort client IP for rate limiting and logs.
 * Deploy note: `cf-connecting-ip` is only trustworthy when the origin accepts traffic from
 * Cloudflare alone (firewall the VPS to Cloudflare's ranges); otherwise a client can send
 * the header itself and dodge the limits.
 */
export function clientIp(requestHeaders: Headers): string {
  return (
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown"
  );
}
