"use client";

import { HeartIcon, LogInIcon, LogOutIcon, PackageIcon, UserIcon, UserPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { initials } from "@/lib/initials";
import { customerSignOutAction } from "@/server/customer-account-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AccountMenuUser = { name: string; email: string; image: string | null };

/**
 * The shopper's menu in the store header: the avatar (or a person icon for guests) opens
 * the account links and sign in / sign out (the theme has its own button in the header).
 */
export function AccountMenu({ user }: { user: AccountMenuUser | null }) {
  const t = useTranslations("Store.account");
  const router = useRouter();

  async function signOut() {
    await customerSignOutAction().catch(() => null);
    toast.success(t("toasts.signedOut"));
    router.replace("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("menu.label")}
        className="flex size-9 items-center justify-center rounded-full hover:bg-current/15 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none data-popup-open:bg-current/15"
      >
        {user ? (
          <Avatar className="after:border-current/30">
            {user.image && <AvatarImage src={user.image} alt="" />}
            {/* The brand pair, so the avatar matches the header */}
            <AvatarFallback
              className="text-xs font-semibold"
              style={{ backgroundColor: "var(--brand-foreground)", color: "var(--brand)" }}
            >
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <UserIcon className="size-5" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {user ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate font-medium text-foreground">{user.name}</span>
                <span className="block truncate">{user.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href="/account/orders" />}>
                <PackageIcon />
                {t("orders.title")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/account/favorites" />}>
                <HeartIcon />
                {t("menu.favorites")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/account" />}>
                <UserIcon />
                {t("menu.profile")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href="/login" />}>
              <LogInIcon />
              {t("menu.signIn")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/signup" />}>
              <UserPlusIcon />
              {t("menu.signUp")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOutIcon />
              {t("signOut")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
