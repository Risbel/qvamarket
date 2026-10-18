"use client";

import {
  BadgePercent,
  ChevronsUpDown,
  ExternalLink,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/initials";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

const ITEMS = {
  home: { href: "/dashboard", icon: LayoutDashboard, exact: true },
  orders: { href: "/dashboard/orders", icon: ShoppingBag, exact: false },
  products: { href: "/dashboard/products", icon: Package, exact: false },
  categories: { href: "/dashboard/categories", icon: FolderTree, exact: false },
  promotions: { href: "/dashboard/promotions", icon: BadgePercent, exact: false },
  settings: { href: "/dashboard/settings", icon: Settings, exact: false },
  team: { href: "/dashboard/team", icon: Users, exact: false },
  roles: { href: "/dashboard/roles", icon: ShieldCheck, exact: false },
  stores: { href: "/admin", icon: Store, exact: true },
  newMerchant: { href: "/admin/merchants/new", icon: UserPlus, exact: false },
} as const;

export type PanelNavKey = keyof typeof ITEMS;
export type PanelNavGroup = {
  /** Key in `Panel.groups`; no label for the first, unnamed group. */
  label?: "catalog" | "store" | "team" | "platform";
  items: PanelNavKey[];
};

export type PanelSidebarProps = {
  /** Only what the user is allowed to use (computed on the server from permissions). */
  groups: PanelNavGroup[];
  brand: { title: string; subtitle: string; logoUrl: string | null; href: string };
  user: { name: string; email: string };
  /** Public storefront link, shown as "View store". */
  storeUrl?: string;
  /** While impersonating, account actions are hidden (the banner has "stop"). */
  impersonating: boolean;
};

function isActive(key: PanelNavKey, pathname: string) {
  const item = ITEMS[key];
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The item the current page belongs to (for the page header). */
export function useActiveNavKey(groups: PanelNavGroup[]): PanelNavKey | null {
  const pathname = usePathname();
  return groups.flatMap((g) => g.items).find((key) => isActive(key, pathname)) ?? null;
}

function UserIdentity({ user }: { user: PanelSidebarProps["user"] }) {
  return (
    <>
      <Avatar className="rounded-lg after:rounded-lg">
        <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </>
  );
}

export function PanelSidebar({ groups, brand, user, storeUrl, impersonating }: PanelSidebarProps) {
  const t = useTranslations("Panel");
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  // On phones the sidebar is a sheet: close it once a link is followed
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  async function signOut() {
    await authClient.signOut();
    toast.success(t("toasts.signedOut"));
    router.push("/login");
    router.refresh();
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={brand.title}
              render={<Link href={brand.href} onClick={closeOnMobile} />}
            >
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                  <img src={brand.logoUrl} alt="" width={32} height={32} className="size-8 bg-white object-contain" />
                ) : (
                  <Store className="size-4" />
                )}
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{brand.title}</span>
                <span className="truncate text-xs text-muted-foreground">{brand.subtitle}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label={t("nav.label")} className="flex flex-col">
          {groups.map((group, index) => (
            <SidebarGroup key={group.label ?? index}>
              {group.label && <SidebarGroupLabel>{t(`groups.${group.label}`)}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((key) => {
                    const { href, icon: Icon } = ITEMS[key];
                    const active = isActive(key, pathname);
                    return (
                      <SidebarMenuItem key={key}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={t(`nav.${key}`)}
                          render={
                            <Link
                              href={href}
                              aria-current={active ? "page" : undefined}
                              onClick={closeOnMobile}
                            />
                          }
                        >
                          <Icon />
                          <span>{t(`nav.${key}`)}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
        {storeUrl && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={t("viewStore")}
                    render={<a href={storeUrl} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink />
                    <span>{t("viewStore")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {impersonating ? (
              // No account actions while impersonating (the banner has "stop"): just who it is
              <div className="flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!">
                <UserIdentity user={user} />
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      size="lg"
                      aria-label={t("account.menu")}
                      className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                    />
                  }
                >
                  <UserIdentity user={user} />
                  <ChevronsUpDown className="ml-auto" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side={isMobile ? "top" : "right"}
                  align="end"
                  sideOffset={4}
                  className="w-auto min-w-56"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                      <span className="block truncate font-medium text-foreground">{user.name}</span>
                      <span className="block truncate">{user.email}</span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem render={<Link href="/change-password" onClick={closeOnMobile} />}>
                      <KeyRound />
                      {t("account.changePassword")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={signOut}>
                      <LogOut />
                      {t("account.signOut")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
