"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { LatLng, LngLat } from "@/lib/map";
import { BaseMap } from "@/components/map/base-map";

const AREA_COLOR = "#2563eb";

/**
 * The customer's delivery pin: the store's service area is drawn, a click (or a drag of the
 * pin, or "use my location" in the parent) sets where to deliver. Nothing is decided here:
 * the parent computes the fee and the server checks the area again.
 */
export function DeliveryPinMap({
  area,
  storeLocation,
  value,
  onChange,
  locale,
  labels,
}: {
  area: LngLat[];
  storeLocation: LatLng;
  value: LatLng | null;
  onChange: (location: LatLng) => void;
  locale: string;
  labels: { map: string; error: string; unavailable: string };
}) {
  const [map, setMap] = useState<{ map: MapLibreMap; maplibre: typeof import("maplibre-gl") } | null>(null);
  const pin = useRef<Marker | null>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!map) return;
    const onClick = (event: { lngLat: { lng: number; lat: number } }) => change.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    map.map.on("click", onClick);
    return () => {
      map.map.off("click", onClick);
    };
  }, [map]);

  // The customer's pin follows the value (click, drag or geolocation)
  useEffect(() => {
    if (!map || !value) return;
    if (!pin.current) {
      pin.current = new map.maplibre.Marker({ draggable: true, color: "#dc2626" }).setLngLat([value.lng, value.lat]).addTo(map.map);
      pin.current.on("dragend", () => {
        const point = pin.current!.getLngLat();
        change.current({ lat: point.lat, lng: point.lng });
      });
    } else {
      pin.current.setLngLat([value.lng, value.lat]);
    }
    if (!map.map.getBounds().contains([value.lng, value.lat])) map.map.easeTo({ center: [value.lng, value.lat] });
  }, [map, value]);

  function onReady(ready: MapLibreMap, maplibre: typeof import("maplibre-gl")) {
    const ring = [...area, area[0]];
    ready.addSource("area", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
    });
    ready.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": AREA_COLOR, "fill-opacity": 0.1 } });
    ready.addLayer({ id: "area-outline", type: "line", source: "area", paint: { "line-color": AREA_COLOR, "line-width": 2 } });
    new maplibre.Marker({ color: "#6b7280", scale: 0.7 }).setLngLat([storeLocation.lng, storeLocation.lat]).addTo(ready);
    const bounds = new maplibre.LngLatBounds();
    for (const corner of area) bounds.extend(corner);
    ready.fitBounds(bounds, { padding: 30, duration: 0 });
    setMap({ map: ready, maplibre });
  }

  return (
    <BaseMap
      center={value ?? storeLocation}
      zoom={13}
      locale={locale}
      onReady={onReady}
      errorText={labels.error}
      unavailableText={labels.unavailable}
      aria-label={labels.map}
      className="h-72 w-full overflow-hidden rounded-lg border sm:h-80"
    />
  );
}
