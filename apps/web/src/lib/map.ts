// Client-safe map constants (see "Maps" in CLAUDE.md).

/** Area covered by the base map archive (the bbox it was cut with): Cuba. [W, S, E, N] */
export const MAP_BOUNDS: [number, number, number, number] = [-85.1, 19.7, -74.0, 23.4];

/** Deepest zoom stored in the archive; the map overzooms beyond it. */
export const MAP_TILE_MAX_ZOOM = 15;

/** Where a map opens when the store has no location yet: Havana. */
export const DEFAULT_MAP_CENTER = { lat: 23.1136, lng: -82.3666 };

/** Max corners of a delivery area; the same limit as the store_delivery DB check. */
export const MAX_SERVICE_AREA_POINTS = 200;

export type LatLng = { lat: number; lng: number };
/** A polygon corner in GeoJSON order. */
export type LngLat = [number, number];
