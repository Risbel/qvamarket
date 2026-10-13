import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { getObjectRange } from "./storage";

// The base map: one PMTiles archive (Protomaps vector tiles of Cuba, cut from the
// OpenStreetMap-based daily build) kept in our own bucket. The browser never talks to a
// third-party tile server: it asks /api/map/tiles/{z}/{x}/{y} and we read that tile from the
// archive with a range request. See "Maps" in CLAUDE.md for how to refresh the file.

/** Storage key of the archive (platform file, not tenant data). */
export const MAP_ARCHIVE_KEY = process.env.MAP_ARCHIVE_KEY ?? "platform/maps/cuba.pmtiles";

class StorageSource implements Source {
  getKey() {
    return MAP_ARCHIVE_KEY;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const { data, etag } = await getObjectRange(MAP_ARCHIVE_KEY, offset, length);
    return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, etag };
  }
}

// One instance per server process: pmtiles caches the archive's header and directories, so
// most tiles cost a single range request
let archive: PMTiles | undefined;
const mapArchive = () => (archive ??= new PMTiles(new StorageSource()));

/**
 * A vector tile, uncompressed (pmtiles already decompresses what the archive stores), or
 * null when the archive has none.
 */
export async function getMapTile(z: number, x: number, y: number) {
  const map = mapArchive();
  try {
    const tile = await map.getZxy(z, x, y);
    return tile ? new Uint8Array(tile.data) : null;
  } catch (error) {
    // pmtiles keeps a failed header read cached: start over on the next request, so a
    // missing archive or a storage hiccup does not break the map until a restart
    if (archive === map) archive = undefined;
    throw error;
  }
}

/** Zoom range and bounds of the archive, for the map style (no tiles are asked outside it). */
export async function getMapInfo() {
  const header = await mapArchive().getHeader();
  return {
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat] as [number, number, number, number],
  };
}
