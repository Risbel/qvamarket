"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { DEFAULT_MAP_CENTER, MAX_SERVICE_AREA_POINTS, type LatLng, type LngLat } from "@/lib/map";
import { useHydrated } from "@/lib/use-hydrated";
import { createDeliveryAreaSchema, type DeliveryAreaValues } from "@/lib/validation/delivery";
import { saveDeliveryAreaAction } from "@/server/catalog-actions";
import { BaseMap } from "@/components/map/base-map";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

type Mode = "location" | "area";
const AREA_COLOR = "#2563eb";

type AreaFeature = {
  type: "Feature";
  properties: { kind: "corner" | "outline" | "area" };
  geometry:
    | { type: "Point"; coordinates: LngLat }
    | { type: "LineString"; coordinates: LngLat[] }
    | { type: "Polygon"; coordinates: LngLat[][] };
};

/** GeoJSON for the drawn area: the polygon (3+ corners), its outline and its corners. */
function areaFeatures(area: LngLat[]): { type: "FeatureCollection"; features: AreaFeature[] } {
  const features: AreaFeature[] = area.map((corner) => ({
    type: "Feature",
    properties: { kind: "corner" },
    geometry: { type: "Point", coordinates: corner },
  }));
  if (area.length >= 2) {
    features.push({
      type: "Feature",
      properties: { kind: "outline" },
      geometry: { type: "LineString", coordinates: area.length >= 3 ? [...area, area[0]] : area },
    });
  }
  if (area.length >= 3) {
    features.push({ type: "Feature", properties: { kind: "area" }, geometry: { type: "Polygon", coordinates: [[...area, area[0]]] } });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Settings > Delivery, map part: click to place the store (orders leave from there), or
 * switch to drawing and click corner by corner around the area the store delivers to.
 */
export function DeliveryAreaForm({ initialValues }: { initialValues: DeliveryAreaValues }) {
  const t = useTranslations("Settings.delivery");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [mode, setMode] = useState<Mode>(initialValues.location ? "area" : "location");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [map, setMap] = useState<{ map: MapLibreMap; maplibre: typeof import("maplibre-gl") } | null>(null);
  const marker = useRef<Marker | null>(null);

  const schema = useMemo(() => createDeliveryAreaSchema(tv), [tv]);
  const form = useForm<DeliveryAreaValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const location = useWatch({ control: form.control, name: "location" });
  const area = useWatch({ control: form.control, name: "area" });

  // Latest values for the map's click handler (registered once)
  const latest = useRef({ mode, area });
  useEffect(() => {
    latest.current = { mode, area };
  }, [mode, area]);

  // Map clicks: place the store, or add a corner to the area
  useEffect(() => {
    if (!map) return;
    const onClick = (event: { lngLat: { lng: number; lat: number } }) => {
      const { lng, lat } = event.lngLat;
      if (latest.current.mode === "location") {
        form.setValue("location", { lat, lng }, { shouldDirty: true });
      } else if (latest.current.area.length < MAX_SERVICE_AREA_POINTS) {
        form.setValue("area", [...latest.current.area, [lng, lat]], { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
      }
    };
    map.map.on("click", onClick);
    return () => {
      map.map.off("click", onClick);
    };
  }, [map, form]);

  // Draw the area
  useEffect(() => {
    (map?.map.getSource("area") as GeoJSONSource | undefined)?.setData(areaFeatures(area));
  }, [map, area]);

  // The store's pin (draggable)
  useEffect(() => {
    if (!map) return;
    if (!location) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new map.maplibre.Marker({ draggable: true, color: "#dc2626" }).setLngLat([location.lng, location.lat]).addTo(map.map);
      marker.current.on("dragend", () => {
        const point = marker.current!.getLngLat();
        form.setValue("location", { lat: point.lat, lng: point.lng }, { shouldDirty: true });
      });
    } else {
      marker.current.setLngLat([location.lng, location.lat]);
    }
  }, [map, location, form]);

  function onReady(ready: MapLibreMap, maplibre: typeof import("maplibre-gl")) {
    ready.addSource("area", { type: "geojson", data: areaFeatures(initialValues.area) });
    ready.addLayer({ id: "area-fill", type: "fill", source: "area", filter: ["==", ["get", "kind"], "area"], paint: { "fill-color": AREA_COLOR, "fill-opacity": 0.15 } });
    ready.addLayer({ id: "area-outline", type: "line", source: "area", filter: ["==", ["get", "kind"], "outline"], paint: { "line-color": AREA_COLOR, "line-width": 2 } });
    ready.addLayer({
      id: "area-corners",
      type: "circle",
      source: "area",
      filter: ["==", ["get", "kind"], "corner"],
      paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": AREA_COLOR, "circle-stroke-width": 2 },
    });
    if (initialValues.area.length >= 3) {
      const bounds = new maplibre.LngLatBounds();
      for (const corner of initialValues.area) bounds.extend(corner);
      ready.fitBounds(bounds, { padding: 40, duration: 0 });
    }
    setMap({ map: ready, maplibre });
  }

  async function onSubmit(values: DeliveryAreaValues) {
    setStatus(null);
    const result = await saveDeliveryAreaAction(values, locale).catch(() => null);
    if (result?.ok) {
      setStatus({ ok: true, text: t("saved") });
      form.reset(values);
      router.refresh();
    } else if (result?.error === "invalid") {
      const messages = Object.values(result.fieldErrors ?? {}).flat();
      setStatus({ ok: false, text: messages[0] ?? t("errors.failed") });
    } else {
      setStatus({ ok: false, text: t(`errors.${result?.error === "forbidden" ? "forbidden" : "failed"}`) });
    }
  }

  const center: LatLng = initialValues.location ?? DEFAULT_MAP_CENTER;
  const areaError = form.formState.errors.area;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t("modeLabel")} className="flex flex-wrap gap-2">
        {(["location", "area"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            variant={mode === option ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(option)}
          >
            {t(`mode.${option}`)}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t(`modeHelp.${mode}`)}</p>

      <BaseMap
        center={center}
        zoom={initialValues.location ? 14 : 12}
        locale={locale}
        onReady={onReady}
        errorText={t("mapError")}
        unavailableText={t("tilesUnavailable")}
        aria-label={t("mapLabel")}
        className="h-[28rem] w-full overflow-hidden rounded-lg border"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={area.length === 0}
          onClick={() => form.setValue("area", area.slice(0, -1), { shouldDirty: true })}
        >
          {t("undo")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={area.length === 0} onClick={() => form.setValue("area", [], { shouldDirty: true })}>
          {t("clearArea")}
        </Button>
        <span className="text-sm text-muted-foreground">{t("points", { count: area.length })}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {location ? t("locationSet", { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) }) : t("noLocation")}
      </p>
      {areaError && <FieldError>{areaError.message ?? areaError.root?.message}</FieldError>}
      {status && (
        <p role="status" className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {status.text}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
