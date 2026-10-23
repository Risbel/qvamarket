import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { storePath } from "@/lib/panel-paths";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOpenShifts, lastCounted, listClosedSessions } from "@/server/register";
import { requirePanelSection } from "@/server/tenant";
import { OpenRegister, type OpenSessionView } from "./open-register";
import { OpenRegisterForm } from "./open-register-form";

/**
 * The store's cash register, one shift per cashier: the viewer's open shift (cash in / out,
 * close) or the form to open one; for supervisors, the other cashiers' open shifts; and the
 * closed shifts with their Z reports (only the viewer's own unless they supervise).
 */
export default async function RegisterPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/register">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);
  const merchant = await requirePanelSection(locale, storeId, "register");
  const t = await getTranslations("Register");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const viewer = { userId: merchant.session.user.id, supervise: merchant.can({ register: ["supervise"] }) };
  const [shifts, history] = await Promise.all([getOpenShifts(scope, viewer), listClosedSessions(scope, viewer)]);
  const own = shifts.find((s) => s.own);
  const others = shifts.filter((s) => !s.own);
  const suggested = own ? {} : await lastCounted(scope, viewer.userId);
  const currencies = merchant.store.currencies.map((c) => ({ code: c.code, digits: c.digits }));

  const view = (shift: (typeof shifts)[number]): OpenSessionView => ({
    id: shift.id,
    number: shift.number,
    openedAt: shift.openedAt.toISOString(),
    cashier: shift.cashier,
    own: shift.own,
    openingNote: shift.openingNote,
    drawers: shift.drawers,
    movements: shift.movements.map((m) => ({
      id: m.id,
      kind: m.kind as "in" | "out",
      currency: m.currency,
      amountMinor: m.amountMinor,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      by: m.by,
    })),
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      {own ? (
        <OpenRegister session={view(own)} currencies={currencies} supervise={viewer.supervise} />
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

      {others.length > 0 && (
        <section aria-labelledby="other-shifts" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="other-shifts" className="text-lg font-semibold">
              {t("others.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("others.description")}</p>
          </div>
          {others.map((shift) => (
            <OpenRegister key={shift.id} session={view(shift)} currencies={currencies} supervise={viewer.supervise} />
          ))}
        </section>
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
                  <TableHead>{t("history.cashier")}</TableHead>
                  <TableHead>{t("history.closedAt")}</TableHead>
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
                    <TableCell className="text-sm">
                      {h.cashier ?? "—"}
                      {h.closedByUserId !== h.cashierUserId && h.closedBy && (
                        <span className="block text-xs text-muted-foreground">{t("history.closedByOther", { name: h.closedBy })}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{h.closedAt && <LocalDateTime iso={h.closedAt.toISOString()} locale={locale} />}</TableCell>
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
