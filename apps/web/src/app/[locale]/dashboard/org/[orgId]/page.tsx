import { headers } from "next/headers";
import { ArrowRight, Store } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { storePath } from "@/lib/panel-paths";
import { buildStoreUrl } from "@/lib/tenancy";
import { publicUrl } from "@/server/storage";
import { requireCompany } from "@/server/tenant";
import { CreateStoreDialog } from "./create-store-dialog";

/** The company's home: its stores (open one to work on it), or an empty state. */
export default async function CompanyStoresPage({ params }: PageProps<"/[locale]/dashboard/org/[orgId]">) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  const company = await requireCompany(locale, orgId);
  const t = await getTranslations("Stores");
  const host = (await headers()).get("host");
  // The public address around the subdomain, for the create form's hint
  const [urlStart, urlEnd] = buildStoreUrl("__slug__", host).split("__slug__");
  // Only owners create stores (decided 2026-10: not a permission, no other role can)
  const create = company.isOwner && <CreateStoreDialog url={[urlStart, urlEnd]} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description", { company: company.companyName })}</p>
        </div>
        {company.stores.length > 0 && create}
      </div>

      {company.stores.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Store aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t(company.isOwner ? "emptyDescription" : "emptyDescriptionMember")}</EmptyDescription>
          </EmptyHeader>
          {create && <EmptyContent>{create}</EmptyContent>}
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {company.stores.map((store) => {
            const url = buildStoreUrl(store.slug, host);
            return (
              <li key={store.id}>
                <Card className="h-full">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {store.logoKey ? (
                        // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                        <img src={publicUrl(store.logoKey)} alt="" width={40} height={40} className="size-10 bg-white object-contain" />
                      ) : (
                        <Store className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <div className="grid min-w-0 gap-1">
                      <CardTitle className="truncate">{store.name}</CardTitle>
                      <CardDescription className="truncate">
                        <a href={url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                          {url.replace(/^https?:\/\//, "")}
                        </a>
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardFooter className="mt-auto flex items-center justify-between gap-2">
                    <Badge variant={store.status === "active" ? "default" : store.status === "pending" ? "outline" : "secondary"}>
                      {t(`status.${store.status}`)}
                    </Badge>
                    <Link href={storePath(store.id)} className={buttonVariants({ size: "sm" })}>
                      {t("open")}
                      <ArrowRight aria-hidden />
                    </Link>
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
