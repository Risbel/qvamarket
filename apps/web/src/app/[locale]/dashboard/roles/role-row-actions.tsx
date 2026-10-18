"use client";

import { useState } from "react";
import { CopyIcon, EyeIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { useCan } from "@/components/permissions/permissions-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteRoleAction } from "@/server/role-actions";

/**
 * `...` menu of a role: edit (or view without role:update, or when the role grants more than
 * the member has), duplicate (role:create, below the limit), delete (role:delete).
 */
export function RoleRowActions({
  id,
  name,
  memberCount,
  aboveYours,
  full,
}: {
  id: string;
  name: string;
  memberCount: number;
  /** the role grants something the current member does not have: view only */
  aboveYours: boolean;
  /** the company has the maximum number of roles */
  full: boolean;
}) {
  const t = useTranslations("Roles");
  const can = useCan();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = can({ role: ["update"] }) && !aboveYours;
  const canDuplicate = can({ role: ["create"] }) && !aboveYours && !full;
  const canDelete = can({ role: ["delete"] }) && !aboveYours;

  async function onDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteRoleAction(id).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      toast.success(t("toasts.deleted", { name }));
      setDeleting(false);
    } else if (result?.error === "inUse") {
      setError(t("deleteInUse", { count: result.memberCount ?? memberCount }));
    } else {
      const key = result?.error === "forbidden" || result?.error === "notFound" || result?.error === "escalation" ? result.error : "failed";
      setError(t(`errors.${key}`));
    }
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.menu", { name })} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem render={<Link href={`/dashboard/roles/${id}`} />}>
            {canEdit ? <PencilIcon /> : <EyeIcon />}
            {canEdit ? t("actions.edit") : t("actions.view")}
          </DropdownMenuItem>
          {canDuplicate && (
            <DropdownMenuItem render={<Link href={`/dashboard/roles/new?from=${id}`} />}>
              <CopyIcon />
              {t("actions.duplicate")}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setError(null);
                  setDeleting(true);
                }}
              >
                <Trash2Icon />
                {t("actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleting} onOpenChange={(open) => !busy && setDeleting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {memberCount > 0 ? t("deleteInUse", { count: memberCount }) : t("deleteConfirm", { name })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>
              {t("cancel")}
            </Button>
            {memberCount === 0 && (
              <Button variant="destructive" disabled={busy} onClick={onDelete}>
                {t("actions.delete")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
