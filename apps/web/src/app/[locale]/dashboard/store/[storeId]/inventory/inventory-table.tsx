"use client";

import { useStorePath } from "@/components/panel-scope";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortFn,
} from "@tanstack/react-table";
import { CoinsIcon, HistoryIcon, MoreHorizontalIcon, PackageIcon, ScaleIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { inventoryValue, LOW_STOCK } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import type { FormCurrency } from "@/lib/validation/product";
import { SortButton } from "@/components/data-table/sort-button";
import { useCan } from "@/components/permissions/permissions-provider";
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
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { EditCostDialog } from "./edit-cost-dialog";

export type InventoryRow = {
  id: string;
  productId: string;
  productName: string;
  productStatus: "draft" | "active" | "archived";
  /** variant label, e.g. "M / Rojo"; null for a product without options */
  title: string | null;
  sku: string | null;
  /** null = stock not tracked */
  stock: number | null;
  /** unit cost; null = unknown */
  cost: { minor: number; currencyCode: string } | null;
};

const FILTERS = ["all", "low", "out", "noCost"] as const;
type Filter = (typeof FILTERS)[number];

function matches(row: InventoryRow, filter: Filter) {
  if (filter === "low") return row.stock !== null && row.stock > 0 && row.stock <= LOW_STOCK;
  if (filter === "out") return row.stock === 0;
  if (filter === "noCost") return row.cost === null;
  return true;
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
type Features = typeof features;
type RowSortFn = SortFn<Features, InventoryRow>;
const helper = createColumnHelper<Features, InventoryRow>();

const byNumber: RowSortFn = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id);

const COLUMN_CLASS: Partial<Record<string, string>> = {
  stock: "text-right",
  cost: "text-right",
  value: "text-right",
  actions: "w-12 text-right",
};

type Dialog = { kind: "adjust" | "cost"; row: InventoryRow } | null;

/**
 * Every variant of the store with its stock, unit cost and stock value. Sorted in the
 * browser (no sort = by product name, as the server sends them). Members with
 * inventory:update adjust the stock and edit the cost from the row menu.
 */
export function InventoryTable({ rows, baseCurrency }: { rows: InventoryRow[]; baseCurrency: FormCurrency }) {
  const t = useTranslations("Inventory");
  const panelPath = useStorePath();
  const locale = useLocale();
  const can = useCan();
  const canUpdate = can({ inventory: ["update"] });
  const canOpenProducts = can({ product: ["read"] });
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<Dialog>(null);

  const columns = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
    const byText: RowSortFn = (a, b, id) => collator.compare(a.getValue<string>(id), b.getValue<string>(id));

    return helper.columns([
      helper.accessor((row) => `${row.productName} ${row.title ?? ""}`, {
        id: "name",
        header: ({ column }) => (
          <SortButton label={t("columns.product")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
        ),
        sortFn: byText,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Link
              href={panelPath(`/inventory/${row.original.id}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.productName}
            </Link>
            {row.original.title && <span className="text-xs text-muted-foreground">{row.original.title}</span>}
          </div>
        ),
      }),
      helper.accessor((row) => row.sku ?? undefined, {
        id: "sku",
        header: ({ column }) => (
          <SortButton label={t("columns.sku")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
        ),
        sortFn: byText,
        sortUndefined: "last",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.sku ?? "—"}</span>,
      }),
      helper.accessor((row) => row.stock ?? undefined, {
        id: "stock",
        header: ({ column }) => (
          <SortButton label={t("columns.stock")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
        ),
        sortFn: byNumber,
        sortUndefined: "last",
        cell: ({ row }) => {
          const stock = row.original.stock;
          if (stock === null) return <Badge variant="outline">{t("untracked")}</Badge>;
          if (stock === 0) return <Badge variant="destructive">{t("outOfStock")}</Badge>;
          return (
            <span className="inline-flex items-center gap-2 tabular-nums">
              {stock <= LOW_STOCK && <Badge variant="secondary">{t("lowStock")}</Badge>}
              {stock.toLocaleString(locale)}
            </span>
          );
        },
      }),
      helper.accessor((row) => row.cost?.minor, {
        id: "cost",
        header: ({ column }) => (
          <SortButton label={t("columns.cost")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
        ),
        sortFn: byNumber,
        sortUndefined: "last",
        cell: ({ row }) => {
          const cost = row.original.cost;
          return cost ? (
            <span className="tabular-nums">{formatMoney(cost.minor, cost.currencyCode, locale)}</span>
          ) : (
            <span className="text-muted-foreground">{t("noCost")}</span>
          );
        },
      }),
      helper.accessor((row) => inventoryValue(row.stock, row.cost?.minor ?? null) ?? undefined, {
        id: "value",
        header: ({ column }) => (
          <SortButton label={t("columns.value")} sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()} />
        ),
        sortFn: byNumber,
        sortUndefined: "last",
        cell: ({ row }) => {
          const value = inventoryValue(row.original.stock, row.original.cost?.minor ?? null);
          return value !== null && row.original.cost ? (
            <span className="tabular-nums">{formatMoney(value, row.original.cost.currencyCode, locale)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      }),
      helper.display({
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            canUpdate={canUpdate}
            canOpenProduct={canOpenProducts}
            onOpen={(kind) => setDialog({ kind, row: row.original })}
          />
        ),
      }),
    ]);
  }, [t, locale, canUpdate, canOpenProducts, panelPath]);

  const data = useMemo(() => rows.filter((row) => matches(row, filter)), [rows, filter]);
  const table = useTable({ features, columns, data, sortDescFirst: false, getRowId: (row) => row.id });
  // The dialog keeps the row it was opened with; after a save the page sends fresh rows
  const open = dialog ? (rows.find((row) => row.id === dialog.row.id) ?? dialog.row) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <ButtonGroup aria-label={t("filters.label")}>
          {FILTERS.map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={key === filter ? "default" : "outline"}
              aria-pressed={key === filter}
              onClick={() => setFilter(key)}
            >
              {t(`filters.${key}`)} ({rows.filter((row) => matches(row, key)).length})
            </Button>
          ))}
        </ButtonGroup>
      </div>

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
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                {t("noMatches")}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.original.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={COLUMN_CLASS[cell.column.id]}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {canUpdate && (
        <>
          <AdjustStockDialog
            row={dialog?.kind === "adjust" ? open : null}
            baseCurrency={baseCurrency}
            onOpenChange={(next) => !next && setDialog(null)}
          />
          <EditCostDialog
            row={dialog?.kind === "cost" ? open : null}
            baseCurrency={baseCurrency}
            onOpenChange={(next) => !next && setDialog(null)}
          />
        </>
      )}
    </div>
  );
}

function RowActions({
  row,
  canUpdate,
  canOpenProduct,
  onOpen,
}: {
  row: InventoryRow;
  canUpdate: boolean;
  canOpenProduct: boolean;
  onOpen: (kind: "adjust" | "cost") => void;
}) {
  const t = useTranslations("Inventory");
  const panelPath = useStorePath();
  const name = row.title ? `${row.productName} (${row.title})` : row.productName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.menu", { name })} />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {canUpdate && (
          <>
            {row.stock !== null && (
              <DropdownMenuItem onClick={() => onOpen("adjust")}>
                <ScaleIcon />
                {t("actions.adjust")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onOpen("cost")}>
              <CoinsIcon />
              {t("actions.cost")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem render={<Link href={panelPath(`/inventory/${row.id}`)} />}>
          <HistoryIcon />
          {t("actions.history")}
        </DropdownMenuItem>
        {canOpenProduct && (
          <DropdownMenuItem render={<Link href={panelPath(`/products/${row.productId}/edit`)} />}>
            <PackageIcon />
            {t("actions.product")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
