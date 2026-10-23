"use server";

import { z } from "zod";
import { BANNER_DEVICES, MAX_IMAGE_BYTES, SECONDARY_BANNER_SIDES } from "@/lib/images";
import {
  createSecondaryPair,
  deleteSecondaryPair,
  moveSecondaryPair,
  setSecondaryBannerVisible,
  setSecondaryPairImage,
  type SecondaryBannerError,
} from "./secondary-banner";
import { getMerchantOrNull } from "./tenant";
import { planFeatureError, type PlanFeatureError } from "@/lib/plans";

export type SecondaryBannerActionResult =
  | { ok: true }
  | PlanFeatureError
  | { ok: false; error: SecondaryBannerError | "forbidden" | "failed" | "empty" };

// The banner is store configuration: it needs `store:update` (owner and manager).
async function authorize(storeId: unknown) {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ store: ["update"] })) return null;
  return {
    tenantId: merchant.tenantId,
    storeId: merchant.store.id,
    // adding to the secondary banner needs the plan feature; removing, moving or hiding it does not
    hasFeature: merchant.hasFeature("secondaryBanner"),
  };
}

async function guard(name: string, run: () => Promise<SecondaryBannerActionResult>) {
  try {
    return await run();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" } as const;
  }
}

export async function createSecondaryPairAction(storeId: unknown, device: unknown): Promise<SecondaryBannerActionResult> {
  const scope = await authorize(storeId);
  if (!scope) return { ok: false, error: "forbidden" };
  if (!scope.hasFeature) return planFeatureError("secondaryBanner");
  const parsed = z.enum(BANNER_DEVICES).safeParse(device);
  if (!parsed.success) return { ok: false, error: "failed" };
  return guard("createSecondaryPairAction", async () => {
    const result = await createSecondaryPair(scope, parsed.data);
    return result.ok ? { ok: true } : result;
  });
}

/** FormData: `pairId`, `side` (left | right) and `file`. */
export async function uploadSecondaryPairImageAction(storeId: unknown, formData: FormData): Promise<SecondaryBannerActionResult> {
  const scope = await authorize(storeId);
  if (!scope) return { ok: false, error: "forbidden" };
  if (!scope.hasFeature) return planFeatureError("secondaryBanner");

  const pairId = z.uuid().safeParse(formData.get("pairId"));
  if (!pairId.success) return { ok: false, error: "notFound" };
  const side = z.enum(SECONDARY_BANNER_SIDES).safeParse(formData.get("side"));
  if (!side.success) return { ok: false, error: "failed" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };

  return guard("uploadSecondaryPairImageAction", async () =>
    setSecondaryPairImage(scope, pairId.data, side.data, new Uint8Array(await file.arrayBuffer())),
  );
}

export async function deleteSecondaryPairAction(storeId: unknown, id: unknown): Promise<SecondaryBannerActionResult> {
  const scope = await authorize(storeId);
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "notFound" };
  return guard("deleteSecondaryPairAction", () => deleteSecondaryPair(scope, parsed.data));
}

export async function moveSecondaryPairAction(storeId: unknown, id: unknown, direction: unknown): Promise<SecondaryBannerActionResult> {
  const scope = await authorize(storeId);
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success || (direction !== "up" && direction !== "down")) return { ok: false, error: "notFound" };
  return guard("moveSecondaryPairAction", () => moveSecondaryPair(scope, parsed.data, direction));
}

export async function setSecondaryBannerVisibleAction(storeId: unknown, visible: unknown): Promise<SecondaryBannerActionResult> {
  const scope = await authorize(storeId);
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = z.boolean().safeParse(visible);
  if (!parsed.success) return { ok: false, error: "failed" };
  return guard("setSecondaryBannerVisibleAction", async () =>
    (await setSecondaryBannerVisible(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" },
  );
}
