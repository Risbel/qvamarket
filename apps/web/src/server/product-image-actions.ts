"use server";

import { z } from "zod";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { discardProductUpload, stageProductImage, type ImageError } from "./product-images";
import { publicUrl } from "./storage";
import { getMerchantOrNull } from "./tenant";

export type StageImageResult =
  | { ok: true; uploadId: string; url: string }
  | { ok: false; error: ImageError | "forbidden" | "failed" };

// Images are saved with the product form: whoever may create or edit products may stage them.
async function authorize() {
  const merchant = await getMerchantOrNull();
  if (!merchant || !(merchant.can({ product: ["create"] }) || merchant.can({ product: ["update"] }))) {
    return null;
  }
  return {
    scope: { tenantId: merchant.tenantId, storeId: merchant.store.id },
    userId: merchant.session.user.id,
  };
}

/** Uploads one image picked in the product form; it is attached when the form is saved. */
export async function stageProductImageAction(formData: FormData): Promise<StageImageResult> {
  const merchant = await authorize();
  if (!merchant) return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  // Reject before reading the bytes; the type and size are checked again in stageProductImage
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };

  try {
    const result = await stageProductImage(merchant.scope, merchant.userId, new Uint8Array(await file.arrayBuffer()));
    return result.ok ? { ok: true, uploadId: result.id, url: publicUrl(result.storageKey) } : result;
  } catch (error) {
    console.error("stageProductImageAction failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Best effort: a staged upload taken out of the form (unsaved ones are swept anyway). */
export async function discardProductUploadAction(uploadId: unknown): Promise<void> {
  const merchant = await authorize();
  const id = z.uuid().safeParse(uploadId);
  if (!merchant || !id.success) return;
  try {
    await discardProductUpload(merchant.scope, id.data);
  } catch (error) {
    console.error("discardProductUploadAction failed", error);
  }
}
