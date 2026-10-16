"use client";

import { useState } from "react";
import { HeartIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { savePendingFavorite } from "@/lib/favorites";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFavorites } from "./favorites-provider";
import { IMAGE_BUTTON } from "./image-button";

/**
 * Where to come back after signing in: this page as the shopper sees it, without the locale
 * prefix (the login page adds it back). Never the internal /stores/<slug> path.
 */
function currentPath(locale: string): string {
  const { pathname, search } = window.location;
  const path = pathname === `/${locale}` ? "/" : pathname.startsWith(`/${locale}/`) ? pathname.slice(locale.length + 1) : pathname;
  return path + search;
}

/**
 * The heart that marks a product as a favorite. Guests get a dialog that sends them to sign
 * in (or sign up) and back to this page, where the product is then saved by itself.
 */
export function FavoriteButton({
  productId,
  productName,
  className,
}: {
  productId: string;
  productName: string;
  className?: string;
}) {
  const t = useTranslations("Store.favorites");
  const locale = useLocale();
  const hydrated = useHydrated();
  const { signedIn, isFavorite, setFavorite } = useFavorites();
  const [askToSignIn, setAskToSignIn] = useState(false);
  const [next, setNext] = useState("/");
  const on = isFavorite(productId);

  function onClick() {
    if (signedIn) {
      void setFavorite(productId, !on);
    } else {
      setNext(currentPath(locale));
      setAskToSignIn(true);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onClick}
        disabled={!hydrated}
        aria-pressed={on}
        aria-label={t(on ? "remove" : "add", { name: productName })}
        className={cn(IMAGE_BUTTON, "disabled:opacity-100", className)}
      >
        <HeartIcon className={cn("size-5", on && "fill-current text-rose-600 dark:text-rose-500")} aria-hidden />
      </Button>
      <Dialog open={askToSignIn} onOpenChange={setAskToSignIn}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartIcon className="size-5 text-rose-600 dark:text-rose-500" aria-hidden />
              {t("dialog.title")}
            </DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Link
              href={{ pathname: "/signup", query: { next } }}
              onClick={() => savePendingFavorite(productId)}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("dialog.signUp")}
            </Link>
            <Link
              href={{ pathname: "/login", query: { next } }}
              onClick={() => savePendingFavorite(productId)}
              className={buttonVariants()}
              style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              {t("dialog.signIn")}
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
