"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { addFavorite, removeFavorite } from "./favorites";
import { getHostStore } from "./public-store";
import { createRateLimiter } from "./rate-limit";

export type SetFavoriteResult =
  | { ok: true }
  | { ok: false; error: "signedOut" | "notFound" | "limitReached" | "tooManyAttempts" | "failed" };

// Per account: a heart is one click, but a script could hammer it
const toggles = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });

/**
 * Marks (`favorite` true) or unmarks a product for the signed-in shopper. The store is the
 * request's Host (never the browser's input) and the session must be this host's.
 */
export async function setFavoriteAction(productId: unknown, favorite: unknown): Promise<SetFavoriteResult> {
  const requestHeaders = await headers();
  const store = await getHostStore(requestHeaders);
  const id = z.uuid().safeParse(productId);
  if (!store || !id.success || typeof favorite !== "boolean") return { ok: false, error: "notFound" };

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { ok: false, error: "signedOut" };
  if (!toggles.tryConsume(session.user.id)) return { ok: false, error: "tooManyAttempts" };

  try {
    if (favorite) return await addFavorite(store.id, session.user, id.data);
    await removeFavorite(store.id, session.user.id, id.data);
    return { ok: true };
  } catch (error) {
    console.error("setFavoriteAction failed", error);
    return { ok: false, error: "failed" };
  }
}
