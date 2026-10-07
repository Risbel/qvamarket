import { db, desc, eq, and, member, organization, store, user } from "@qvashop/db";
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
import { ResetPasswordDialog } from "./reset-password-dialog";

export default async function AdminHomePage({
  params,
}: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");
  const host = (await headers()).get("host");

  // Superadmin view across all tenants (the layout already enforced the admin role)
  const rows = await db
    .select({
      storeId: store.id,
      storeName: store.name,
      slug: store.slug,
      isActive: store.isActive,
      company: organization.name,
      ownerId: user.id,
      ownerEmail: user.email,
      createdAt: store.createdAt,
    })
    .from(store)
    .innerJoin(organization, eq(store.tenantId, organization.id))
    .leftJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.role, "owner")),
    )
    .leftJoin(user, eq(user.id, member.userId))
    .orderBy(desc(store.createdAt));

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
                <TableCell>{row.company}</TableCell>
                <TableCell>{row.ownerEmail ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? t("status.active") : t("status.inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {row.ownerId && row.ownerEmail && (
                    <ResetPasswordDialog userId={row.ownerId} email={row.ownerEmail} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
