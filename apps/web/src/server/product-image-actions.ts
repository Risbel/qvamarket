"use server";

import { z } from "zod";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import {
  addProductImage,
  deleteProductImage,
  setMainProductImage,
  type ImageError,
} from "./product-images";
import { getMerchantOrNull } from "./tenant";

export type ImageActionResult =
  | { ok: true }
  | { ok: false; error: ImageError | "forbidden" | "failed" };

// Images belong to the product: changing them needs the same permission as editing it.
async function authorize() {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ product: ["update"] })) return null;
  return { tenantId: merchant.tenantId, storeId: merchant.store.id };
}

export async function uploadProductImageAction(
  productId: unknown,
  formData: FormData,
): Promise<ImageActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "notFound" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  // Reject before reading the bytes; the type and size are checked again in addProductImage
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };

  try {
    const result = await addProductImage(scope, id.data, new Uint8Array(await file.arrayBuffer()));
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("uploadProductImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function deleteProductImageAction(imageId: unknown): Promise<ImageActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(imageId);
  if (!id.success) return { ok: false, error: "notFound" };

  try {
    return await deleteProductImage(scope, id.data);
  } catch (error) {
    console.error("deleteProductImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function setMainProductImageAction(imageId: unknown): Promise<ImageActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(imageId);
  if (!id.success) return { ok: false, error: "notFound" };

  try {
    return await setMainProductImage(scope, id.data);
  } catch (error) {
    console.error("setMainProductImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}
