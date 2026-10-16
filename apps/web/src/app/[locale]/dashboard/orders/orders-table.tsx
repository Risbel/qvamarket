"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useDebouncedCallback } from "use-debounce";
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
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { EyeIcon, MessageCircleIcon, MoreHorizontalIcon, PhoneIcon, SearchIcon, Truck, XIcon } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import type { DateRange } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import {
  ORDER_PAGE_SIZES,
  ORDER_QUERY_MAX,
  hasOrderFilters,
  orderListQuery,
  type OrderListParams,
  type OrderSortColumn,
} from "@/lib/order-list";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  orderReference,
  orderStatusVariant,
  paymentStatusVariant,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { cn } from "@/lib/utils";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { Pagination } from "@/components/data-table/pagination";
import { SortButton } from "@/components/data-table/sort-button";
import { ViewOptions } from "@/components/data-table/view-options";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateFilter } from "./date-filter";

export type OrderRow = {
  id: string;
  number: number;
  /** ISO instant, shown in the viewer's timezone */
  createdAt: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentType: string;
  currencyCode: string;
  totalMinor: number;
  units: number;
};

// Filtering, sorting and pagination run on the server (see order-list.ts): the table only
// holds the current page, and every change of its state becomes a new URL.
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, OrderRow>();

/** Extra classes per column id (header and cells). */
const COLUMN_CLASS: Partial<Record<string, string>> = {
  units: "text-right tabular-nums",
  total: "text-right tabular-nums",
  actions: "w-12 text-right",
};

export function OrdersTable({
  rows,
  total,
  facets,
  params,
}: {
  rows: OrderRow[];
  /** orders matching the filters, on every page */
  total: number;
  /** per value: orders the filter would show (see countOrderFacets) */
  facets: { status: Record<string, number>; payment: Record<string, number> };
  params: OrderListParams;
}) {
  const t = useTranslations("Orders");
  const tTable = useTranslations("DataTable");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});

  function navigate(next: OrderListParams, { replace = false } = {}) {
    const href = { pathname: "/dashboard/orders", query: orderListQuery(next) };
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  // The table's state, read from the URL
  const sorting: SortingState = [params.sort];
  const columnFilters: ColumnFiltersState = [
    ...(params.statuses.length ? [{ id: "status", value: params.statuses }] : []),
    ...(params.payments.length ? [{ id: "payment", value: params.payments }] : []),
    ...(params.range ? [{ id: "date", value: params.range }] : []),
  ];
  const pagination: PaginationState = { pageIndex: params.page - 1, pageSize: params.pageSize };

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("number", {
          header: () => t("columns.number"),
          enableHiding: false,
          enableSorting: false,
          cell: ({ row }) => (
            <span className="font-medium whitespace-nowrap">
              <Link href={`/dashboard/orders/${row.original.id}`} className="underline-offset-4 hover:underline">
                {orderReference(row.original.number)}
              </Link>
              {row.original.fulfillmentType === "delivery" && (
                <span title={t("fulfillment.delivery")} className="ml-1.5 inline-flex align-text-bottom text-muted-foreground">
                  <Truck className="size-4" aria-hidden />
                  <span className="sr-only">{t("fulfillment.delivery")}</span>
                </span>
              )}
            </span>
          ),
        }),
        helper.accessor("createdAt", {
          id: "date",
          header: ({ column }) => (
            <SortButton
              label={t("columns.date")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
            />
          ),
          // First click: newest first (totals: biggest first; names: A to Z)
          sortDescFirst: true,
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              <LocalDateTime iso={row.original.createdAt} locale={locale} />
            </span>
          ),
        }),
        helper.accessor("customerName", {
          id: "customer",
          header: ({ column }) => (
            <SortButton
              label={t("columns.customer")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
            />
          ),
          sortDescFirst: false,
          cell: ({ row }) => (
            <>
              <div>{row.original.customerName}</div>
              <div className="text-sm text-muted-foreground">{row.original.customerPhone}</div>
            </>
          ),
        }),
        helper.accessor("units", {
          header: () => t("columns.units"),
          enableSorting: false,
        }),
        helper.accessor("totalMinor", {
          id: "total",
          header: ({ column }) => (
            <SortButton
              label={t("columns.total")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
              className="-mr-2.5 ml-0"
            />
          ),
          sortDescFirst: true,
          cell: ({ row }) => formatMoney(row.original.totalMinor, row.original.currencyCode, locale),
        }),
        helper.accessor("status", {
          header: () => t("columns.status"),
          enableSorting: false,
          cell: ({ row }) => (
            <Badge variant={orderStatusVariant(row.original.status)}>{t(`status.${row.original.status}`)}</Badge>
          ),
        }),
        helper.accessor("paymentStatus", {
          id: "payment",
          header: () => t("columns.payment"),
          enableSorting: false,
          cell: ({ row }) => (
            <Badge variant={paymentStatusVariant(row.original.paymentStatus)}>
              {t(`payment.${row.original.paymentStatus}`)}
            </Badge>
          ),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          cell: ({ row }) => <RowActions order={row.original} />,
        }),
      ]),
    [t, locale],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (row) => row.id,
    state: { sorting, columnFilters, globalFilter: params.query, pagination, columnVisibility },
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    rowCount: total,
    // There is always an order (newest first by default): clicking a sorted column flips it
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const [next] = functionalUpdate(updater, sorting);
      if (next) navigate({ ...params, sort: { id: next.id as OrderSortColumn, desc: next.desc }, page: 1 });
    },
    onColumnFiltersChange: (updater) => {
      const next = functionalUpdate(updater, columnFilters);
      const value = (id: string) => next.find((filter) => filter.id === id)?.value;
      navigate({
        ...params,
        statuses: (value("status") as OrderStatus[] | undefined) ?? [],
        payments: (value("payment") as PaymentStatus[] | undefined) ?? [],
        range: (value("date") as DateRange | undefined) ?? null,
        page: 1,
      });
    },
    // Typing fires this many times: replace the history entry instead of adding one per word
    onGlobalFilterChange: (updater) => {
      const query = String(functionalUpdate(updater, params.query) ?? "").slice(0, ORDER_QUERY_MAX);
      navigate({ ...params, query, page: 1 }, { replace: true });
    },
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, pagination);
      const sizeChanged = next.pageSize !== params.pageSize;
      navigate({ ...params, pageSize: next.pageSize, page: sizeChanged ? 1 : next.pageIndex + 1 });
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const statusColumn = table.getColumn("status");
  const paymentColumn = table.getColumn("payment");
  const dateColumn = table.getColumn("date");
  const visibleCount = table.getVisibleLeafColumns().length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <OrderSearch value={params.query} hidden={orderListQuery({ ...params, query: "", page: 1 })} onChange={table.setGlobalFilter} />
        <FacetedFilter
          title={t("columns.status")}
          options={ORDER_STATUSES.map((value) => ({ value, label: t(`status.${value}`), count: facets.status[value] ?? 0 }))}
          selected={params.statuses}
          onChange={(values) => statusColumn?.setFilterValue(values.length ? values : undefined)}
        />
        <FacetedFilter
          title={t("columns.payment")}
          options={PAYMENT_STATUSES.map((value) => ({ value, label: t(`payment.${value}`), count: facets.payment[value] ?? 0 }))}
          selected={params.payments}
          onChange={(values) => paymentColumn?.setFilterValue(values.length ? values : undefined)}
        />
        <DateFilter value={params.range} onChange={(range) => dateColumn?.setFilterValue(range ?? undefined)} />
        {hasOrderFilters(params) && (
          <Button
            variant="ghost"
            onClick={() => navigate({ ...params, statuses: [], payments: [], range: null, query: "", page: 1 })}
          >
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
              label: t(`columns.${column.id as "date" | "customer" | "units" | "total" | "status" | "payment"}`),
              visible: column.getIsVisible(),
            }))}
          onToggle={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
        />
      </div>

      <div
        aria-busy={pending}
        className={cn("overflow-hidden rounded-md border transition-opacity", pending && "opacity-60")}
      >
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
        pageSizes={ORDER_PAGE_SIZES}
        onPageChange={table.setPageIndex}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}

/**
 * Search by order number, name or phone. The list follows the typing (debounced); it is also
 * a GET form, so Enter works even before hydration (the other filters ride along hidden).
 */
function OrderSearch({
  value,
  hidden,
  onChange,
}: {
  value: string;
  hidden: Record<string, string>;
  onChange: (query: string) => void;
}) {
  const t = useTranslations("Orders.search");
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const debounced = useDebouncedCallback((query: string) => onChange(query.trim()), 400);

  // The URL changed elsewhere (reset, back button): show its query, unless the merchant is
  // still typing (a newer search is on its way)
  if (value !== shown) {
    setShown(value);
    if (!debounced.isPending() && value !== text.trim()) setText(value);
  }

  return (
    <form
      method="get"
      role="search"
      className="w-full sm:w-64"
      onSubmit={(event) => {
        event.preventDefault();
        debounced.flush();
      }}
    >
      {Object.entries(hidden).map(([name, val]) => (
        <input key={name} type="hidden" name={name} value={val} />
      ))}
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          name="q"
          type="search"
          value={text}
          maxLength={ORDER_QUERY_MAX}
          onChange={(event) => {
            setText(event.target.value);
            debounced(event.target.value);
          }}
          placeholder={t("placeholder")}
          aria-label={t("label")}
        />
      </InputGroup>
    </form>
  );
}

function RowActions({ order }: { order: OrderRow }) {
  const t = useTranslations("Orders.rowActions");
  // wa.me wants the number with its country code and no "+"; only offered for a full number
  const whatsapp = order.customerPhone.startsWith("+") ? `https://wa.me/${order.customerPhone.slice(1)}` : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("menu", { reference: orderReference(order.number) })} />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuItem render={<Link href={`/dashboard/orders/${order.id}`} />}>
          <EyeIcon />
          {t("view")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href={`tel:${order.customerPhone}`} />}>
          <PhoneIcon />
          {t("call")}
        </DropdownMenuItem>
        {whatsapp && (
          <DropdownMenuItem render={<a href={whatsapp} target="_blank" rel="noreferrer" />}>
            <MessageCircleIcon />
            {t("whatsapp")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
