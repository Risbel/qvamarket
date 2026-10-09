import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
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
import { mainImageKeys } from "@/server/product-images";
import { listProducts } from "@/server/products";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { DeleteProductButton } from "./delete-product-button";

export default async function ProductsPage({
  params,
}: PageProps<"/[locale]/dashboard/products">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { product: ["read"] });
  const t = await getTranslations("Products");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const products = await listProducts(scope);
  const mainImages = await mainImageKeys(
    scope,
    products.map((p) => p.id),
  );

  // What the member may do (the Server Actions check it again)
  const canCreate = merchant.can({ product: ["create"] });
  const canUpdate = merchant.can({ product: ["update"] });
  const canDelete = merchant.can({ product: ["delete"] });
  const showActions = canUpdate || canDelete;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {canCreate && (
          <Link href="/dashboard/products/new" className={buttonVariants()}>
            {t("newButton")}
          </Link>
        )}
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">
                <span className="sr-only">{t("columns.image")}</span>
              </TableHead>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.price")}</TableHead>
              <TableHead>{t("columns.stock")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              {showActions && (
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {mainImages.has(p.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                    <img
                      src={publicUrl(mainImages.get(p.id)!)}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="size-10 rounded-md bg-muted" aria-hidden />
                  )}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  {formatMoney(p.priceMinor, merchant.store.currency, locale)}
                </TableCell>
                <TableCell>{p.stock ?? t("stockUntracked")}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "active" ? "default" : "secondary"}>
                    {t(`status.${p.status as "draft" | "active" | "archived"}`)}
                  </Badge>
                </TableCell>
                {showActions && (
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {canUpdate && (
                        <Link
                          href={`/dashboard/products/${p.id}/edit`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          {t("editButton")}
                        </Link>
                      )}
                      {canDelete && <DeleteProductButton id={p.id} name={p.name} />}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
