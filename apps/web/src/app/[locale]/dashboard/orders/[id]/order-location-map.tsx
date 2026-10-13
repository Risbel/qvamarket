"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@/lib/map";
import { BaseMap } from "@/components/map/base-map";

/** Where the customer asked for the delivery: their pin, read only. */
export function OrderLocationMap({
  location,
  locale,
  labels,
}: {
  location: LatLng;
  locale: string;
  labels: { map: string; error: string; unavailable: string };
}) {
  function onReady(map: MapLibreMap, maplibre: typeof import("maplibre-gl")) {
    new maplibre.Marker({ color: "#dc2626" }).setLngLat([location.lng, location.lat]).addTo(map);
  }

  return (
    <BaseMap
      center={location}
      zoom={16}
      locale={locale}
      onReady={onReady}
      errorText={labels.error}
      unavailableText={labels.unavailable}
      aria-label={labels.map}
      className="h-48 w-full overflow-hidden rounded-md border"
    />
  );
}
