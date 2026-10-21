"use client";

import { useStorePath } from "@/components/panel-scope";
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
import { EyeIcon, MailIcon, MessageCircleIcon, MoreHorizontalIcon, PhoneIcon } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import {
  CUSTOMER_PAGE_SIZES,
  CUSTOMER_QUERY_MAX,
  customerListQuery,
  type CustomerListParams,
  type CustomerSortColumn,
} from "@/lib/customer-list";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/data-table/pagination";
import { Search } from "@/components/data-table/search";
import { SortButton } from "@/components/data-table/sort-button";
import { ViewOptions } from "@/components/data-table/view-options";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  hasAccount: boolean;
  /** orders in this store, cancelled included */
  orders: number;
  /** in the list's currency, orders not cancelled; null = nothing spent in it */
  spentMinor: number | null;
  /** ISO instant, shown in the viewer's timezone */
  lastOrderAt: string;
};

// Searching, sorting and pagination run on the server (see customer-list.ts): the table only
// holds the current page, and every change of its state becomes a new URL. (Global
// filtering needs the column filtering feature, even without column filters.)
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, CustomerRow>();

/** Extra classes per column id (header and cells). */
const COLUMN_CLASS: Partial<Record<string, string>> = {
  orders: "text-right tabular-nums",
  spentMinor: "text-right tabular-nums",
  actions: "w-12 text-right",
};

/** wa.me wants the number with its country code and no "+"; only offered for a full number */
const whatsappUrl = (phone: string | null) => (phone?.startsWith("+") ? `https://wa.me/${phone.slice(1)}` : null);

export function CustomersTable({
  rows,
  total,
  params,
  currency,
  currencies,
  defaultCurrency,
}: {
  rows: CustomerRow[];
  /** customers matching the search, on every page */
  total: number;
  params: CustomerListParams;
  /** what "spent" is shown and sorted in */
  currency: string;
  /** the switch's options (only shown with 2+) */
  currencies: string[];
  defaultCurrency: string;
}) {
  const t = useTranslations("Customers");
  const panelPath = useStorePath();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});

  function navigate(next: CustomerListParams, { replace = false } = {}) {
    const href = { pathname: panelPath("/customers"), query: customerListQuery(next) };
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
        helper.accessor("name", {
          header: ({ column }) => (
            <SortButton
              label={t("columns.customer")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
            />
          ),
          enableHiding: false,
          // First click: A to Z (orders and dates: most first)
          sortDescFirst: false,
          cell: ({ row }) => (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={panelPath(`/customers/${row.original.id}`)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.original.name}
                </Link>
                {row.original.hasAccount && <Badge variant="secondary">{t("account")}</Badge>}
              </div>
              <div className="text-sm text-muted-foreground tabular-nums">
                {row.original.phone ?? row.original.email}
              </div>
            </>
          ),
        }),
        helper.accessor("orders", {
          header: ({ column }) => (
            <SortButton
              label={t("columns.orders")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
              className="-mr-2.5 ml-0"
            />
          ),
          sortDescFirst: true,
        }),
        // In one currency (the switch): amounts are never added across currencies
        helper.accessor("spentMinor", {
          id: "spent",
          header: ({ column }) => (
            <SortButton
              label={t("columns.spent")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
              className="-mr-2.5 ml-0"
            />
          ),
          sortDescFirst: true,
          cell: ({ row }) =>
            row.original.spentMinor !== null ? (
              formatMoney(row.original.spentMinor, currency, locale)
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        }),
        helper.accessor("lastOrderAt", {
          id: "lastOrder",
          header: ({ column }) => (
            <SortButton
              label={t("columns.lastOrder")}
              sorted={column.getIsSorted()}
              onClick={column.getToggleSortingHandler()}
            />
          ),
          sortDescFirst: true,
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              <LocalDateTime iso={row.original.lastOrderAt} locale={locale} />
            </span>
          ),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          cell: ({ row }) => <RowActions customer={row.original} />,
        }),
      ]),
    [t, locale, panelPath, currency],
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
    // There is always an order (most recent buyers first by default)
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const [next] = functionalUpdate(updater, sorting);
      if (next) navigate({ ...params, sort: { id: next.id as CustomerSortColumn, desc: next.desc }, page: 1 });
    },
    // Typing fires this many times: replace the history entry instead of adding one per word
    onGlobalFilterChange: (updater) => {
      const query = String(functionalUpdate(updater, params.query) ?? "").slice(0, CUSTOMER_QUERY_MAX);
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
          hidden={customerListQuery({ ...params, query: "", page: 1 })}
          maxLength={CUSTOMER_QUERY_MAX}
          label={t("search.label")}
          placeholder={t("search.placeholder")}
          onChange={table.setGlobalFilter}
        />
        {currencies.length > 1 && (
          <ButtonGroup aria-label={t("currency")}>
            {currencies.map((code) => (
              <Button
                key={code}
                type="button"
                size="sm"
                variant={code === currency ? "default" : "outline"}
                aria-pressed={code === currency}
                onClick={() => navigate({ ...params, currency: code === defaultCurrency ? "" : code, page: 1 })}
              >
                {code}
              </Button>
            ))}
          </ButtonGroup>
        )}
        <ViewOptions
          columns={table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide() && column.id !== "actions")
            .map((column) => ({
              id: column.id,
              label: t(`columns.${column.id as "orders" | "spent" | "lastOrder"}`),
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
        pageSizes={CUSTOMER_PAGE_SIZES}
        onPageChange={table.setPageIndex}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}

function RowActions({ customer }: { customer: CustomerRow }) {
  const t = useTranslations("Customers.rowActions");
  const panelPath = useStorePath();
  const whatsapp = whatsappUrl(customer.phone);
  const contact = customer.phone || customer.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("menu", { name: customer.name })} />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuItem render={<Link href={panelPath(`/customers/${customer.id}`)} />}>
          <EyeIcon />
          {t("view")}
        </DropdownMenuItem>
        {contact && <DropdownMenuSeparator />}
        {customer.phone && (
          <DropdownMenuItem render={<a href={`tel:${customer.phone}`} />}>
            <PhoneIcon />
            {t("call")}
          </DropdownMenuItem>
        )}
        {whatsapp && (
          <DropdownMenuItem render={<a href={whatsapp} target="_blank" rel="noreferrer" />}>
            <MessageCircleIcon />
            {t("whatsapp")}
          </DropdownMenuItem>
        )}
        {customer.email && (
          <DropdownMenuItem render={<a href={`mailto:${customer.email}`} />}>
            <MailIcon />
            {t("email")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
