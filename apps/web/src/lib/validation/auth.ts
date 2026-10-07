import { z } from "zod";
import type { Translator } from "./types";

export const MIN_PASSWORD_LENGTH = 8;

export function createLoginSchema(t: Translator) {
  return z.object({
    email: z.email(t("emailInvalid")),
    password: z.string().min(1, t("required")),
  });
}

export type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>;

export function createChangePasswordSchema(t: Translator) {
  return z
    .object({
      currentPassword: z.string().min(1, t("required")),
      newPassword: z
        .string()
        .min(MIN_PASSWORD_LENGTH, t("passwordMin", { min: MIN_PASSWORD_LENGTH })),
      confirmPassword: z.string().min(1, t("required")),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordsDontMatch"),
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      path: ["newPassword"],
      message: t("passwordSameAsCurrent"),
    });
}

export type ChangePasswordValues = z.infer<
  ReturnType<typeof createChangePasswordSchema>
>;
