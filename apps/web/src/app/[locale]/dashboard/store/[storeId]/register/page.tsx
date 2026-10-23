import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { storePath } from "@/lib/panel-paths";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOpenRegister, lastCounted, listClosedSessions } from "@/server/register";
import { requirePanelSection } from "@/server/tenant";
import { OpenRegister, type OpenSessionView } from "./open-register";
import { OpenRegisterForm } from "./open-register-form";

/**
 * The store's cash register: the open session (live drawer per currency, cash in / out,
 * close), or the form to open one, and the closed sessions with their Z reports.
 */
export default async function RegisterPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/register">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);
  const merchant = await requirePanelSection(locale, storeId, "register");
  const t = await getTranslations("Register");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const [open, history] = await Promise.all([getOpenRegister(scope), listClosedSessions(scope)]);
  const suggested = open ? {} : await lastCounted(scope);
  const currencies = merchant.store.currencies.map((c) => ({ code: c.code, digits: c.digits }));

  const session: OpenSessionView | null = open
    ? {
        number: open.number,
        openedAt: open.openedAt.toISOString(),
        openedBy: open.openedBy,
        openingNote: open.openingNote,
        drawers: open.drawers,
        movements: open.movements.map((m) => ({
          id: m.id,
          kind: m.kind as "in" | "out",
          currency: m.currency,
          amountMinor: m.amountMinor,
          note: m.note,
          createdAt: m.createdAt.toISOString(),
          by: m.by,
        })),
      }
    : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      {session ? (
        <OpenRegister session={session} currencies={currencies} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("closed.title")}</h2>
            </CardTitle>
            <CardDescription>{t("closed.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <OpenRegisterForm currencies={currencies} suggested={suggested} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("history.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground">{t("history.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.number")}</TableHead>
                  <TableHead>{t("history.closedAt")}</TableHead>
                  <TableHead>{t("history.closedBy")}</TableHead>
                  <TableHead>{t("history.result")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <Link href={storePath(merchant.store.id, `/register/${h.id}`)} className="font-medium underline-offset-4 hover:underline">
                        {t("history.z", { number: h.number })}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{h.closedAt && <LocalDateTime iso={h.closedAt.toISOString()} locale={locale} />}</TableCell>
                    <TableCell className="text-sm">{h.closedBy ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {h.currencies.map((c) => (
                          <Badge key={c.currency} variant={c.differenceMinor === 0 ? "secondary" : "destructive"}>
                            {c.differenceMinor === 0
                              ? t("history.even", { currency: c.currency })
                              : t(c.differenceMinor > 0 ? "history.over" : "history.short", {
                                  amount: formatMoney(Math.abs(c.differenceMinor), c.currency, locale),
                                })}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
