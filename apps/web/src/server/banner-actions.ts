"use server";

import { z } from "zod";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { addBannerImage, deleteBannerImage, moveBannerImage, type BannerError } from "./store-banner";
import { getMerchantOrNull } from "./tenant";

export type BannerActionResult =
  | { ok: true }
  | { ok: false; error: BannerError | "forbidden" | "failed" | "empty" };

// The banner is store configuration: it needs `store:update` (owner and manager).
async function authorize() {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ store: ["update"] })) return null;
  return { tenantId: merchant.tenantId, storeId: merchant.store.id };
}

export async function uploadBannerImageAction(formData: FormData): Promise<BannerActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };

  try {
    const result = await addBannerImage(scope, new Uint8Array(await file.arrayBuffer()));
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("uploadBannerImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function deleteBannerImageAction(id: unknown): Promise<BannerActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "notFound" };
  try {
    return await deleteBannerImage(scope, parsed.data);
  } catch (error) {
    console.error("deleteBannerImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function moveBannerImageAction(id: unknown, direction: unknown): Promise<BannerActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success || (direction !== "up" && direction !== "down")) return { ok: false, error: "notFound" };
  try {
    return await moveBannerImage(scope, parsed.data, direction);
  } catch (error) {
    console.error("moveBannerImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}
