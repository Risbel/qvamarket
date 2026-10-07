import { z } from "zod";
import type { Translator } from "./types";

export function createLoginSchema(t: Translator) {
  return z.object({
    email: z.email(t("emailInvalid")),
    password: z.string().min(1, t("required")),
  });
}

export type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>;
