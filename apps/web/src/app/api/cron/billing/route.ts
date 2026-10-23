import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runBillingJob } from "@/server/billing";

// Never prerendered or cached: every call runs the job
export const dynamic = "force-dynamic";

/** Constant-time comparison of the bearer token with CRON_SECRET. */
function authorized(header: string | null, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/cron/billing: the daily billing job (renewal invoices, ended trials and pauses,
 * past due, expired). Called by a scheduled task (Dokploy) with
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the route is off (503). Safe to
 * call more than once a day: every step is idempotent.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response(null, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return new Response(null, { status: 401 });
  const summary = await runBillingJob();
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
