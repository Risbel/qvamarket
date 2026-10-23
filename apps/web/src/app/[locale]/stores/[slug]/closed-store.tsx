import { StoreIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buildStoreTheme } from "@/lib/store-theme";
import { StoreThemeProvider } from "@/components/store-theme-provider";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * What a store shows while it is closed for now (its company's subscription is paused, or the
 * company is over its plan's store limit): its name and logo in its colors, and that it will
 * be back. Nothing of the catalog, the cart or the checkout is served.
 */
export async function ClosedStore({
  store,
}: {
  store: { name: string; logoUrl: string | null; primaryColor: string | null; accentColor: string | null };
}) {
  const t = await getTranslations("Store.closed");
  const theme = buildStoreTheme({ primary: store.primaryColor, accent: store.accentColor, radius: null, base: null, tinted: false });
  return (
    <StoreThemeProvider theme={theme}>
      <main className="flex flex-1 items-center justify-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {store.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                <img src={store.logoUrl} alt="" className="size-full rounded-md object-cover" />
              ) : (
                <StoreIcon />
              )}
            </EmptyMedia>
            <EmptyTitle>{store.name}</EmptyTitle>
            <EmptyDescription>{t("description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    </StoreThemeProvider>
  );
}
