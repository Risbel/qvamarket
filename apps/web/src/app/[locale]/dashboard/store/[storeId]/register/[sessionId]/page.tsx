import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { storePath } from "@/lib/panel-paths";
import { LocalDateTime } from "@/components/local-date-time";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSessionReport } from "@/server/register";
import { requirePanelSection } from "@/server/tenant";
import { PrintButton } from "./print-button";

/**
 * The Z report of a closed shift: the frozen snapshot written at close (never recomputed, so
 * later changes elsewhere cannot alter it). Printable. A cashier sees only their own shifts.
 */
export default async function RegisterReportPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/register/[sessionId]">) {
  const { locale, storeId, sessionId } = await params;
  setRequestLocale(locale);
  const merchant = await requirePanelSection(locale, storeId, "register");
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const report = await getSessionReport({ tenantId: merchant.tenantId, storeId: merchant.store.id }, sessionId.toLowerCase(), {
    userId: merchant.session.user.id,
    supervise: merchant.can({ register: ["supervise"] }),
  });
  if (!report) notFound();
  const t = await getTranslations("Register.report");
  const td = await getTranslations("Register.drawer");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={storePath(merchant.store.id, "/register")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
        <PrintButton />
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title", { number: report.number })}</h1>
        <p className="text-sm text-muted-foreground">{merchant.store.name}</p>
        {report.openedBy && <p className="text-sm font-medium">{t("cashier", { name: report.openedBy })}</p>}
        <p className="text-sm">
          {t("opened")} <LocalDateTime iso={report.openedAt} locale={locale} />
        </p>
        <p className="text-sm">
          {t("closed")} <LocalDateTime iso={report.closedAt} locale={locale} />
          {report.closedBy && ` · ${report.closedBy}`}
        </p>
      </div>

      {report.currencies.map((c) => {
        const money = (minor: number) => formatMoney(minor, c.currency, locale);
        const rows: [string, number, string][] = [
          [td("opening"), c.openingMinor, ""],
          [td("cashPayments"), c.cashPaymentsMinor, "+"],
          [td("cashRefunds"), c.cashRefundsMinor, "−"],
          [td("cashIn"), c.cashInMinor, "+"],
          [td("cashOut"), c.cashOutMinor, "−"],
          [td("cashExpenses"), c.cashExpensesMinor, "−"],
        ];
        return (
          <Card key={c.currency} className="break-inside-avoid">
            <CardHeader>
              <CardTitle>
                <h2>{c.currency}</h2>
              </CardTitle>
              <CardDescription>
                {c.differenceMinor === 0
                  ? t("even")
                  : t(c.differenceMinor > 0 ? "over" : "short", { amount: money(Math.abs(c.differenceMinor)) })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <dl className="flex flex-col gap-1 text-sm">
                {rows.map(([label, minor, sign]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums">
                      {sign && minor !== 0 ? `${sign} ` : ""}
                      {money(minor)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2 border-t pt-1 font-medium">
                  <dt>{t("expected")}</dt>
                  <dd className="tabular-nums">{money(c.expectedMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2 font-medium">
                  <dt>{t("counted")}</dt>
                  <dd className="tabular-nums">{money(c.countedMinor)}</dd>
                </div>
                <div className={c.differenceMinor === 0 ? "flex justify-between gap-2" : "flex justify-between gap-2 font-semibold text-destructive"}>
                  <dt>{t("difference")}</dt>
                  <dd className="tabular-nums">
                    {c.differenceMinor > 0 ? "+" : c.differenceMinor < 0 ? "−" : ""}
                    {money(Math.abs(c.differenceMinor))}
                  </dd>
                </div>
              </dl>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{td("transfers")}</dt>
                  <dd className="tabular-nums">{money(c.byMethod.transfer.paymentsMinor - c.byMethod.transfer.refundsMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{td("other")}</dt>
                  <dd className="tabular-nums">{money(c.byMethod.other.paymentsMinor - c.byMethod.other.refundsMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{td("otherExpenses")}</dt>
                  <dd className="tabular-nums">{money(c.otherExpensesMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{td("sales", { count: c.orders })}</dt>
                  <dd className="tabular-nums">{money(c.salesMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("records")}</dt>
                  <dd className="tabular-nums">{t("recordsValue", { payments: c.payments, expenses: c.expenses })}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        );
      })}

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle>
            <h2>{t("movements")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMovements")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("when")}</TableHead>
                  <TableHead>{t("reason")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.movements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">
                      <LocalDateTime iso={m.at} locale={locale} />
                      {m.by && <span className="block text-xs text-muted-foreground">{m.by}</span>}
                    </TableCell>
                    <TableCell className="text-sm whitespace-pre-line">{m.note}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.kind === "out" ? "−" : "+"}
                      {formatMoney(m.amountMinor, m.currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {report.recounts && report.recounts.length > 0 && (
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>
              <h2>{t("recounts")}</h2>
            </CardTitle>
            <CardDescription>{t("recountsHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {report.recounts.map((r, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <LocalDateTime iso={r.at} locale={locale} />
                    {r.by && <span className="text-muted-foreground"> · {r.by}</span>}
                  </span>
                  <span className="tabular-nums">
                    {Object.entries(r.counted)
                      .map(([currency, minor]) => formatMoney(minor, currency, locale))
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(report.openingNote || report.closingNote) && (
        <Card className="break-inside-avoid">
          <CardContent className="flex flex-col gap-2 text-sm">
            {report.openingNote && (
              <p>
                <span className="font-medium">{t("openingNote")}</span> {report.openingNote}
              </p>
            )}
            {report.closingNote && (
              <p>
                <span className="font-medium">{t("closingNote")}</span> {report.closingNote}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{t("frozen")}</p>
    </div>
  );
}
