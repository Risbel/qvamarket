import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./auth";
import type { Translator } from "./types";

/** A shopper creating their account from a store (one global account, see CLAUDE.md). */
export function createCustomerSignupSchema(t: Translator) {
  return z
    .object({
      name: z.string().trim().min(2, t("required")).max(100, t("tooLong", { max: 100 })),
      email: z.email(t("emailInvalid")).toLowerCase(),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, t("passwordMin", { min: MIN_PASSWORD_LENGTH }))
        .max(128, t("tooLong", { max: 128 })),
      confirmPassword: z.string().min(1, t("required")),
    })
    .refine((v) => v.password === v.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordsDontMatch"),
    });
}
export type CustomerSignupValues = z.infer<ReturnType<typeof createCustomerSignupSchema>>;

/**
 * Where to go after signing in, from `?next=`: only a path on the same site (no "//host",
 * no backslashes, no scheme), so the parameter cannot send the shopper to another site.
 */
export function safeNextPath(value: unknown, fallback = "/account"): string {
  return typeof value === "string" && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : fallback;
}
