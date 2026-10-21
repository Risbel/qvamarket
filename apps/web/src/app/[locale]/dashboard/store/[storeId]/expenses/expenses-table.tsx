"use client";

import { useStorePath, useStoreId } from "@/components/panel-scope";
import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  functionalUpdate,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAGE_SIZES,
  EXPENSE_QUERY_MAX,
  expenseListQuery,
  hasExpenseFilters,
  type ExpenseCategory,
  type ExpenseListParams,
  type ExpenseSortColumn,
} from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import type { PaymentMethod } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { deleteExpenseAction } from "@/server/expense-actions";
import { DateFilter } from "@/components/data-table/date-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { Pagination } from "@/components/data-table/pagination";
import { Search } from "@/components/data-table/search";
import { SortButton } from "@/components/data-table/sort-button";
import { ViewOptions } from "@/components/data-table/view-options";
import { LocalDateTime } from "@/components/local-date-time";
import { useCan } from "@/components/permissions/permissions-provider";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpenseDialog, type EditableExpense, type ExpenseCurrency, type ExpenseMember } from "./expense-dialog";

export type ExpenseRow = EditableExpense & {
  method: PaymentMethod;
  /** who recorded it */
  recordedByName: string | null;
};

// Filtering, sorting and pagination run on the server (see lib/expenses.ts): the table only
// holds the current page, and every change of its state becomes a new URL. (Global
// filtering needs the column filtering feature.)
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, ExpenseRow>();

const COLUMN_CLASS: Partial<Record<string, string>> = {
  amount: "text-right tabular-nums",
  actions: "w-12 text-right",
};

export function ExpensesTable({
  rows,
  total,
  params,
  facets,
  currencies,
  defaultCurrency,
  members,
}: {
  rows: ExpenseRow[];
  /** expenses matching the filters, on every page */
  total: number;
  params: ExpenseListParams;
  /** expenses per category with the other filters applied */
  facets: Record<string, number>;
  currencies: ExpenseCurrency[];
  defaultCurrency: string;
  members: ExpenseMember[];
}) {
  const t = useTranslations("Expenses");
  const tTable = useTranslations("DataTable");
  const panelPath = useStorePath();
  const locale = useLocale();
  const router = useRouter();
  const can = useCan();
  const canUpdate = can({ expense: ["update"] });
  const canDelete = can({ expense: ["delete"] });
  const [pending, startTransition] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);

  function navigate(next: ExpenseListParams, { replace = false } = {}) {
    const href = { pathname: panelPath("/expenses"), query: expenseListQuery(next) };
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  // The table's state, read from the URL
  const sorting: SortingState = [params.sort];
  const pagination: PaginationState = { pageIndex: params.page - 1, pageSize: params.pageSize };

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("paidAt", {
          id: "date",
          header: ({ column }) => (
            <SortButton label={t("columns.date")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
          ),
          enableHiding: false,
          sortDescFirst: true,
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span className="whitespace-nowrap">
                <LocalDateTime iso={row.original.paidAt} locale={locale} />
              </span>
              {row.original.recordedByName && (
                <span className="text-xs text-muted-foreground">{t("recordedBy", { name: row.original.recordedByName })}</span>
              )}
            </div>
          ),
        }),
        helper.accessor("category", {
          header: () => t("columns.category"),
          enableSorting: false,
          cell: ({ row }) => <Badge variant="secondary">{t(`categories.${row.original.category}`)}</Badge>,
        }),
        helper.accessor("payee", {
          header: () => t("columns.payee"),
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex min-w-40 flex-col">
              <span className={row.original.payee ? "font-medium" : "text-muted-foreground"}>{row.original.payee ?? "—"}</span>
              {row.original.note && (
                <span className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{row.original.note}</span>
              )}
            </div>
          ),
        }),
        helper.accessor("method", {
          header: () => t("columns.method"),
          enableSorting: false,
          cell: ({ row }) => <span className="text-muted-foreground">{t(`methods.${row.original.method}`)}</span>,
        }),
        helper.accessor("amountMinor", {
          id: "amount",
          header: ({ column }) => (
            <SortButton
              label={t("columns.amount")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
              className="-mr-2.5 ml-0"
            />
          ),
          sortDescFirst: true,
          cell: ({ row }) => formatMoney(row.original.amountMinor, row.original.currencyCode, locale),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          cell: ({ row }) =>
            canUpdate || canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("rowActions.menu")} />}>
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-40">
                  {canUpdate && (
                    <DropdownMenuItem onClick={() => setEditing(row.original)}>
                      <PencilIcon />
                      {t("rowActions.edit")}
                    </DropdownMenuItem>
                  )}
                  {canUpdate && canDelete && <DropdownMenuSeparator />}
                  {canDelete && (
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(row.original)}>
                      <Trash2Icon />
                      {t("rowActions.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null,
        }),
      ]),
    [t, locale, canUpdate, canDelete],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (row) => row.id,
    state: { sorting, globalFilter: params.query, pagination, columnVisibility },
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    rowCount: total,
    // There is always an order (most recent first by default)
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const [next] = functionalUpdate(updater, sorting);
      if (next) navigate({ ...params, sort: { id: next.id as ExpenseSortColumn, desc: next.desc }, page: 1 });
    },
    // Typing fires this many times: replace the history entry instead of adding one per word
    onGlobalFilterChange: (updater) => {
      const query = String(functionalUpdate(updater, params.query) ?? "").slice(0, EXPENSE_QUERY_MAX);
      navigate({ ...params, query, page: 1 }, { replace: true });
    },
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, pagination);
      const sizeChanged = next.pageSize !== params.pageSize;
      navigate({ ...params, pageSize: next.pageSize, page: sizeChanged ? 1 : next.pageIndex + 1 });
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const visibleCount = table.getVisibleLeafColumns().length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search
          value={params.query}
          hidden={expenseListQuery({ ...params, query: "", page: 1 })}
          maxLength={EXPENSE_QUERY_MAX}
          label={t("search.label")}
          placeholder={t("search.placeholder")}
          onChange={table.setGlobalFilter}
        />
        <FacetedFilter
          title={t("columns.category")}
          options={EXPENSE_CATEGORIES.map((value) => ({ value, label: t(`categories.${value}`), count: facets[value] ?? 0 }))}
          selected={params.categories}
          onChange={(values: ExpenseCategory[]) => navigate({ ...params, categories: values, page: 1 })}
        />
        <DateFilter value={params.range} onChange={(range) => navigate({ ...params, range, page: 1 })} />
        {hasExpenseFilters(params) && (
          <Button variant="ghost" onClick={() => navigate({ ...params, categories: [], range: null, query: "", page: 1 })}>
            {tTable("reset")}
            <XIcon data-icon="inline-end" />
          </Button>
        )}
        <ViewOptions
          columns={table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide() && column.id !== "actions")
            .map((column) => ({
              id: column.id,
              label: t(`columns.${column.id as "category" | "payee" | "method" | "amount"}`),
              visible: column.getIsVisible(),
            }))}
          onToggle={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
        />
      </div>

      <div aria-busy={pending} className={cn("overflow-hidden rounded-md border transition-opacity", pending && "opacity-60")}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={COLUMN_CLASS[header.column.id]}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={COLUMN_CLASS[cell.column.id]}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleCount} className="h-24 text-center text-muted-foreground">
                  {t("noMatches")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        summary={t("count", { count: total })}
        pageIndex={pagination.pageIndex}
        pageCount={table.getPageCount()}
        pageSize={pagination.pageSize}
        pageSizes={EXPENSE_PAGE_SIZES}
        onPageChange={table.setPageIndex}
        onPageSizeChange={table.setPageSize}
      />

      {canUpdate && (
        <ExpenseDialog
          open={editing !== null}
          expense={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          members={members}
        />
      )}
      {canDelete && <DeleteExpenseDialog expense={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function DeleteExpenseDialog({ expense, onClose }: { expense: ExpenseRow | null; onClose: () => void }) {
  const t = useTranslations("Expenses.delete");
  const tc = useTranslations("Expenses.categories");
  const storeId = useStoreId();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!expense) return;
    setBusy(true);
    setError(null);
    const result = await deleteExpenseAction(storeId, expense.id).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      toast.success(t("done"));
      onClose();
      router.refresh();
      return;
    }
    setError(t(result?.error === "forbidden" || result?.error === "notFound" ? `errors.${result.error}` : "errors.failed"));
  }

  return (
    <Dialog
      open={expense !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {expense &&
              t("confirm", {
                category: tc(expense.category),
                amount: formatMoney(expense.amountMinor, expense.currencyCode, locale),
              })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? t("deleting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
