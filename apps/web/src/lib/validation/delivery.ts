import { z } from "zod";
import { MAX_SERVICE_AREA_POINTS } from "@/lib/map";
import type { Translator } from "./types";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * Where the store delivers: its location (orders leave from there; distance fees are
 * measured from it) and the area drawn on the map, [lng, lat] corners. An area needs at
 * least 3 corners; an empty list = no area yet.
 */
export function createDeliveryAreaSchema(t: Translator) {
  return z.object({
    location: z.object({ lat: latitude, lng: longitude }).nullable(),
    area: z
      .array(z.tuple([longitude, latitude]))
      .max(MAX_SERVICE_AREA_POINTS, t("areaTooManyPoints", { max: MAX_SERVICE_AREA_POINTS }))
      .refine((corners) => corners.length === 0 || corners.length >= 3, t("areaTooFewPoints")),
  });
}
export type DeliveryAreaValues = z.infer<ReturnType<typeof createDeliveryAreaSchema>>;
