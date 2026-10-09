import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./auth";
import { createStoreSlugSchema } from "./merchant";
import type { Translator } from "./types";

/** A merchant registering themselves: their own password, no forced change afterwards. */
export function createSignupSchema(t: Translator) {
  return z
    .object({
      userName: z.string().trim().min(2, t("required")),
      userEmail: z.email(t("emailInvalid")).toLowerCase(),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, t("passwordMin", { min: MIN_PASSWORD_LENGTH })),
      confirmPassword: z.string().min(1, t("required")),
      companyName: z.string().trim().min(2, t("required")),
      storeName: z.string().trim().min(2, t("required")),
      storeSlug: createStoreSlugSchema(t),
    })
    .refine((v) => v.password === v.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordsDontMatch"),
    });
}

export type SignupValues = z.infer<ReturnType<typeof createSignupSchema>>;
