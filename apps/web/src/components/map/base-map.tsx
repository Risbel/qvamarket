"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { MAP_BOUNDS, MAP_TILE_MAX_ZOOM, type LatLng } from "@/lib/map";

/**
 * The base map (our own Protomaps tiles of Cuba, see "Maps" in CLAUDE.md). Everything it
 * loads comes from our origin: tiles from /api/map/tiles, fonts and icons from /map, and
 * MapLibre's worker from /map/vendor. `onReady` receives the MapLibre map once its style has
 * loaded, to add markers and layers; it is removed when the component unmounts.
 */
export function BaseMap({
  center,
  zoom = 13,
  locale,
  onReady,
  className,
  errorText,
  unavailableText,
  "aria-label": ariaLabel,
}: {
  center: LatLng;
  zoom?: number;
  locale: string;
  onReady: (map: MapLibreMap, maplibre: typeof import("maplibre-gl")) => void;
  className?: string;
  /** shown when the map cannot start (e.g. no WebGL) */
  errorText: string;
  /** shown over the map when the base map tiles cannot be served (archive missing, storage down) */
  unavailableText: string;
  "aria-label"?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  // The first values only: the map is created once
  const initial = useRef({ center, zoom, locale, onReady });

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !container.current) return;
        maplibre.setWorkerUrl(`/map/vendor/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
        const origin = window.location.origin;
        const { center, zoom, locale, onReady } = initial.current;
        const style: StyleSpecification = {
          version: 8,
          glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
          sprite: `${origin}/map/sprites/light`,
          sources: {
            protomaps: {
              type: "vector",
              tiles: [`${origin}/api/map/tiles/{z}/{x}/{y}`],
              maxzoom: MAP_TILE_MAX_ZOOM,
              bounds: MAP_BOUNDS,
              attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
            },
          },
          layers: layers("protomaps", namedFlavor("light"), { lang: locale }),
        };
        map = new maplibre.Map({
          container: container.current,
          style,
          center: [center.lng, center.lat],
          zoom,
          maxBounds: [
            [MAP_BOUNDS[0] - 1, MAP_BOUNDS[1] - 1],
            [MAP_BOUNDS[2] + 1, MAP_BOUNDS[3] + 1],
          ],
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        // Listening replaces MapLibre's default console.error per failed tile: one notice
        // instead (the map still works for clicking, only the background is missing)
        map.on("error", (event) => {
          if ((event as { sourceId?: string }).sourceId === "protomaps") setTilesDown(true);
          else console.error(event.error);
        });
        const ready = map;
        ready.once("load", () => onReady(ready, maplibre));
      })
      .catch((error) => {
        console.error("map failed to load", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return (
    <div className={`relative ${className ?? ""}`} role="region" aria-label={ariaLabel}>
      <div ref={container} className="size-full" />
      {tilesDown && !failed && (
        <p role="status" className="absolute inset-x-3 top-3 z-10 rounded-md bg-background/90 p-2 text-sm shadow">
          {unavailableText}
        </p>
      )}
      {failed && <p className="p-4 text-sm text-destructive">{errorText}</p>}
    </div>
  );
}
