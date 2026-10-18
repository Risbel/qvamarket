"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { startImpersonationAction } from "@/server/impersonation-actions";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ImpersonateTarget = { userId: string; name: string; email: string; role: string };

/**
 * "Sign in as": pick any member of the store's company. The impersonated session opens that
 * company (the person may work in several); every start is logged (impersonation_log).
 */
export function ImpersonateMenu({ tenantId, targets }: { tenantId: string; targets: ImpersonateTarget[] }) {
  const t = useTranslations("Admin.impersonate");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  async function start(target: ImpersonateTarget) {
    setPending(true);
    setError(null);
    const result = await startImpersonationAction(target.userId, tenantId).catch(() => null);
    if (result?.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError(t(`errors.${result && !result.ok ? result.error : "failed"}`));
    setPending(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" disabled={!hydrated || pending} />}>
          {pending ? t("starting") : t("button")}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("choose")}</DropdownMenuLabel>
            {targets.map((target) => (
              <DropdownMenuItem key={target.userId} onClick={() => start(target)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {target.name} · <span className="font-normal text-muted-foreground">{target.role}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{target.email}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
