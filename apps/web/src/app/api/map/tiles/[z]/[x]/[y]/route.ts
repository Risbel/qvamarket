import type { NextRequest } from "next/server";
import { getMapTile } from "@/server/map-tiles";

const MAX_ZOOM = 22;

/**
 * GET /api/map/tiles/{z}/{x}/{y}: one vector tile of the base map. Public (the map shows
 * only OpenStreetMap data) and served from every host, store subdomains included, so the
 * map is always same-origin. Tiles change only when the archive is refreshed: cache a day.
 * Tiles go out uncompressed (pmtiles decompresses them; Next would undo our own gzip):
 * compression belongs to the edge (Cloudflare / Traefik), see the pre-launch checklist.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/map/tiles/[z]/[x]/[y]">) {
  const { z, x, y } = await ctx.params;
  const [zoom, column, row] = [z, x, y].map((value) => (/^\d{1,7}$/.test(value) ? Number(value) : NaN));
  if (!(zoom <= MAX_ZOOM) || !(column < 2 ** zoom) || !(row < 2 ** zoom)) {
    return new Response(null, { status: 400 });
  }

  let tile;
  try {
    tile = await getMapTile(zoom, column, row);
  } catch (error) {
    console.error("map tile failed", error);
    return new Response(null, { status: 503 });
  }
  if (!tile) return new Response(null, { status: 204 });

  return new Response(new Uint8Array(tile), {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
