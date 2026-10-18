import { z } from "zod";
import { createStoreSlugSchema } from "./merchant";
import type { Translator } from "./types";

/** A new store in an existing company (company panel, owners only). */
export function createNewStoreSchema(t: Translator) {
  return z.object({
    storeName: z.string().trim().min(2, t("required")).max(80, t("tooLong", { max: 80 })),
    storeSlug: createStoreSlugSchema(t),
  });
}

export type NewStoreValues = z.infer<ReturnType<typeof createNewStoreSchema>>;
