"use client";

import {
  ArrowLeft,
  BadgePercent,
  Building2,
  ChartNoAxesCombined,
  ChevronsUpDown,
  Contact,
  CreditCard,
  ExternalLink,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tags,
  UserPlus,
  Users,
  Warehouse,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/initials";
import type { PlanKey } from "@/lib/plans";
import { CompanySwitcher, type PanelCompany } from "@/components/company-switcher";
import { Badge } from "@/components/ui/badge";
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

// Paths are relative to the panel's `basePath` (a store, a company or /admin)
const ITEMS = {
  // store panel
  home: { path: "", icon: LayoutDashboard, exact: true },
  orders: { path: "/orders", icon: ShoppingBag, exact: false },
  customers: { path: "/customers", icon: Contact, exact: false },
  products: { path: "/products", icon: Package, exact: false },
  inventory: { path: "/inventory", icon: Warehouse, exact: false },
  categories: { path: "/categories", icon: FolderTree, exact: false },
  promotions: { path: "/promotions", icon: BadgePercent, exact: false },
  expenses: { path: "/expenses", icon: ReceiptText, exact: false },
  profit: { path: "/profit", icon: ChartNoAxesCombined, exact: false },
  settings: { path: "/settings", icon: Settings, exact: false },
  // company panel
  stores: { path: "", icon: Store, exact: true },
  team: { path: "/team", icon: Users, exact: false },
  roles: { path: "/roles", icon: ShieldCheck, exact: false },
  // superadmin panel
  merchants: { path: "", icon: Store, exact: true },
  newMerchant: { path: "/merchants/new", icon: UserPlus, exact: false },
  billing: { path: "/billing", icon: CreditCard, exact: false },
  prices: { path: "/prices", icon: Tags, exact: false },
} as const;

export type PanelNavKey = keyof typeof ITEMS;
export type PanelNavGroup = {
  /** Key in `Panel.groups`; no label for the first, unnamed group. */
  label?: "catalog" | "finance" | "store" | "team" | "platform";
  items: PanelNavKey[];
};

export type PanelSidebarProps = {
  /** Where the nav items live: storePath(id), orgPath(id) or "/admin". */
  basePath: string;
  /** Only what the user is allowed to use (computed on the server from permissions). */
  groups: PanelNavGroup[];
  /** `icon`: shown when there is no logo, a store (default) or a company */
  brand: { title: string; subtitle: string; logoUrl: string | null; href: string; icon?: "store" | "company" };
  user: { name: string; email: string };
  /** Public storefront link, shown as "View store". */
  storeUrl?: string;
  /** While impersonating, account actions are hidden (the banner has "stop"). */
  impersonating: boolean;
  /** Merchant panel: the user's companies; the switcher shows with 2 or more. */
  companies?: PanelCompany[];
  activeCompanyId?: string;
  /** Store panel: link back to the company's store list. */
  back?: { href: string; label: string };
  /**
   * Sections the role allows but the company's plan does not include, with the plan that has
   * them: shown with a lock and that plan's name (the page explains how to get it).
   */
  locked?: Partial<Record<PanelNavKey, PlanKey>>;
};

function hrefOf(basePath: string, key: PanelNavKey) {
  return `${basePath}${ITEMS[key].path}`;
}

function isActive(basePath: string, key: PanelNavKey, pathname: string) {
  const href = hrefOf(basePath, key);
  return ITEMS[key].exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** The item the current page belongs to (for the page header). */
export function useActiveNavKey(basePath: string, groups: PanelNavGroup[]): PanelNavKey | null {
  const pathname = usePathname();
  return groups.flatMap((g) => g.items).find((key) => isActive(basePath, key, pathname)) ?? null;
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

export function PanelSidebar({
  basePath,
  groups,
  brand,
  user,
  storeUrl,
  impersonating,
  companies = [],
  activeCompanyId,
  back,
  locked,
}: PanelSidebarProps) {
  const t = useTranslations("Panel");
  const tPlans = useTranslations("Plans.plans");
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
                ) : brand.icon === "company" ? (
                  <Building2 className="size-4" />
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
          {companies.length > 1 && activeCompanyId && (
            <CompanySwitcher companies={companies} activeId={activeCompanyId} />
          )}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {back && (
          <SidebarGroup className="pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={back.label}
                    render={<Link href={back.href} onClick={closeOnMobile} />}
                  >
                    <ArrowLeft />
                    <span>{back.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <nav aria-label={t("nav.label")} className="flex flex-col">
          {groups.map((group, index) => (
            <SidebarGroup key={group.label ?? index}>
              {group.label && <SidebarGroupLabel>{t(`groups.${group.label}`)}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((key) => {
                    const { icon: Icon } = ITEMS[key];
                    const lockedPlan = locked?.[key];
                    const href = hrefOf(basePath, key);
                    const active = isActive(basePath, key, pathname);
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
                          {lockedPlan && (
                            <span className="ml-auto flex items-center gap-1 group-data-[collapsible=icon]:hidden">
                              <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                {tPlans(`${lockedPlan}.name`)}
                              </Badge>
                              <span className="sr-only">{t("lockedHint", { plan: tPlans(`${lockedPlan}.name`) })}</span>
                            </span>
                          )}
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
