import { and, asc, companyRole, db, desc, eq, inArray, member, organization, sql, store, subscription, user } from "@qvashop/db";
import { STATUS_BADGE, effectiveSubscription } from "@/lib/billing";
import { isOwner, roleKeys } from "@/lib/permissions";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildStoreUrl } from "@/lib/tenancy";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { headers } from "next/headers";
import { ImpersonateMenu, type ImpersonateTarget } from "./impersonate-button";
import { DeleteStoreDialog } from "./delete-store-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { StoreStatusControls } from "./store-status-controls";

export default async function AdminHomePage({
  params,
}: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");
  const tb = await getTranslations("Billing");
  const tp = await getTranslations("Plans.plans");
  const host = (await headers()).get("host");

  // Superadmin view across all tenants (the layout already enforced the admin role)
  const rows = await db
    .select({
      storeId: store.id,
      storeName: store.name,
      slug: store.slug,
      status: store.status,
      company: organization.name,
      tenantId: store.tenantId,
      ownerId: user.id,
      ownerEmail: user.email,
      createdAt: store.createdAt,
    })
    .from(store)
    .innerJoin(organization, eq(store.tenantId, organization.id))
    // Contact of the company = its oldest member (the person created with it). Not matched
    // by role, so changing someone's company role never hides the row's actions.
    .leftJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(
          member.id,
          sql`(select m.id from member m where m.organization_id = ${organization.id} order by m.created_at asc limit 1)`,
        ),
      ),
    )
    .leftJoin(user, eq(user.id, member.userId))
    // Stores waiting for approval first, then newest first
    .orderBy(sql`(${store.status} = 'pending') desc`, desc(store.createdAt));

  // Every member of the listed companies, for "Sign in as" (admin accounts are never targets)
  const tenantIds = [...new Set(rows.map((row) => row.tenantId))];
  const [members, roles, subscriptions] =
    tenantIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({ tenantId: member.organizationId, userId: user.id, name: user.name, email: user.email, role: member.role })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .where(and(inArray(member.organizationId, tenantIds), sql`${user.role} is distinct from 'admin'`, sql`${user.banned} is not true`))
            .orderBy(asc(member.createdAt)),
          db
            .select({ tenantId: companyRole.tenantId, key: companyRole.key, name: companyRole.name })
            .from(companyRole)
            .where(inArray(companyRole.tenantId, tenantIds)),
          db.select().from(subscription).where(inArray(subscription.tenantId, tenantIds)),
        ]);
  const planOf = (tenantId: string) => effectiveSubscription(subscriptions.find((row) => row.tenantId === tenantId) ?? null);
  const roleName = (tenantId: string, roleString: string) =>
    isOwner(roleString)
      ? t("impersonate.owner")
      : roleKeys(roleString)
          .map((key) => roles.find((r) => r.tenantId === tenantId && r.key === key)?.name ?? key)
          .join(", ");
  const targetsOf = (tenantId: string): ImpersonateTarget[] =>
    members
      .filter((m) => m.tenantId === tenantId)
      .map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: roleName(tenantId, m.role) }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("merchants")}</h1>
        <Link href="/admin/merchants/new" className={buttonVariants()}>
          {t("newMerchant")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.store")}</TableHead>
              <TableHead>{t("columns.company")}</TableHead>
              <TableHead>{t("columns.owner")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.storeId}>
                <TableCell>
                  <div className="font-medium">{row.storeName}</div>
                  <a
                    href={buildStoreUrl(row.slug, host)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {row.slug}
                  </a>
                </TableCell>
                <TableCell>
                  <div>{row.company}</div>
                  {(() => {
                    const plan = planOf(row.tenantId);
                    return (
                      <Link href={`/admin/billing/${row.tenantId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline">
                        {tp(`${plan.plan}.name`)}
                        <Badge variant={STATUS_BADGE[plan.status]}>{tb(`status.${plan.status}`)}</Badge>
                      </Link>
                    );
                  })()}
                </TableCell>
                <TableCell>{row.ownerEmail ?? "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === "active"
                        ? "default"
                        : row.status === "pending"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {t(`status.${row.status as "pending" | "active" | "suspended"}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <StoreStatusControls
                      storeId={row.storeId}
                      storeName={row.storeName}
                      status={row.status as "pending" | "active" | "suspended"}
                    />
                    <ImpersonateMenu tenantId={row.tenantId} targets={targetsOf(row.tenantId)} />
                    {row.ownerId && row.ownerEmail && (
                      <ResetPasswordDialog userId={row.ownerId} email={row.ownerEmail} />
                    )}
                    <DeleteStoreDialog storeId={row.storeId} storeName={row.storeName} slug={row.slug} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
