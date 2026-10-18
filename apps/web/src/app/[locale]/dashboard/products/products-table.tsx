"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type RowSelectionState,
  type SortFn,
} from "@tanstack/react-table";
import {
  ExternalLinkIcon,
  EyeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import type { FormCurrency } from "@/lib/validation/product";
import type { ProductPrice } from "@/server/products";
import { SortButton } from "@/components/data-table/sort-button";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/components/permissions/permissions-provider";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BulkPricesDialog, type BulkPricesMode } from "./bulk-prices-dialog";
import { DeleteProductDialog } from "./delete-product-dialog";

type ProductStatus = "draft" | "active" | "archived";

export type ProductRow = {
  id: string;
  name: string;
  status: ProductStatus;
  categoryName: string | null;
  /** Lowest regular price for 1 unit per currency code (missing = not sold in it), manual or following the rate. */
  prices: Record<string, ProductPrice>;
  variantCount: number;
  /** Sum of the variants' stock; null = some variant does not track it. */
  stock: number | null;
  imageUrl: string | null;
  /** Storefront URL of the product; null when it is not public. */
  publicUrl: string | null;
};

const features = tableFeatures({
  rowSelectionFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
type Features = typeof features;
type RowSortFn = SortFn<Features, ProductRow>;

const helper = createColumnHelper<Features, ProductRow>();

/** Sort order of the status column: what is on sale first. */
const STATUS_RANK: Record<ProductStatus, number> = { active: 0, draft: 1, archived: 2 };

const byNumber: RowSortFn = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id);

/** Extra classes per column id (header and cells). */
const COLUMN_CLASS: Partial<Record<string, string>> = {
  select: "w-10",
  image: "w-14",
  actions: "w-12 text-right",
};

/**
 * The store's products. With 2+ currencies a switch picks the currency of the price column
 * ("Auto" = follows the rate, "Manual" = its own price, "Mixed" = some variants each way).
 * Members who may edit products can select rows and change their prices in that currency at
 * once (follow the rate again / adjust by a percentage).
 */
export function ProductsTable({ rows, currencies }: { rows: ProductRow[]; currencies: FormCurrency[] }) {
  const t = useTranslations("Products");
  const can = useCan();
  const canUpdate = can({ product: ["update"] });
  const canDelete = can({ product: ["delete"] });
  const locale = useLocale();
  const baseCurrency = currencies.find((c) => c.isBase) ?? currencies[0];
  const [currencyCode, setCurrencyCode] = useState(baseCurrency.code);
  const currency = currencies.find((c) => c.code === currencyCode) ?? baseCurrency;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulk, setBulk] = useState<BulkPricesMode | null>(null);

  const columns = useMemo(() => {
    // Locale-aware, ignores case and accents ("árbol" next to "Arbol"), numbers in order ("Talla 2" < "Talla 10")
    const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
    const byText: RowSortFn = (a, b, id) =>
      collator.compare(a.getValue<string>(id), b.getValue<string>(id));

    return helper.columns([
      ...(canUpdate
        ? [
            helper.display({
              id: "select",
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected()}
                  onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
                  aria-label={t("bulk.selectAll")}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(checked) => row.toggleSelected(checked)}
                  aria-label={t("bulk.select", { name: row.original.name })}
                />
              ),
            }),
          ]
        : []),
      helper.display({
        id: "image",
        header: () => <span className="sr-only">{t("columns.image")}</span>,
        cell: ({ row }) =>
          row.original.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
            <img
              src={row.original.imageUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="size-10 rounded-md object-cover"
            />
          ) : (
            <div className="size-10 rounded-md bg-muted" aria-hidden />
          ),
      }),
      helper.accessor("name", {
        header: ({ column }) => (
          <SortButton
            label={t("columns.name")}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()}
          />
        ),
        sortFn: byText,
        // Opens the product: editable with product:update, read-only otherwise
        cell: ({ row }) => (
          <Link
            href={`/dashboard/products/${row.original.id}/edit`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      }),
      helper.accessor((p) => p.categoryName ?? undefined, {
        id: "category",
        header: ({ column }) => (
          <SortButton
            label={t("columns.category")}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()}
          />
        ),
        sortFn: byText,
        sortUndefined: "last",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.categoryName ?? "—"}</span>
        ),
      }),
      helper.accessor((p) => p.prices[currency.code]?.minor, {
        id: "price",
        header: ({ column }) => (
          <SortButton
            label={t("columns.price")}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()}
          />
        ),
        sortFn: byNumber,
        sortUndefined: "last",
        cell: ({ row }) => {
          const p = row.original;
          const price = p.prices[currency.code];
          if (!price) return <span className="text-muted-foreground">{t("noPrice")}</span>;
          return (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {(p.variantCount > 1 ? t("fromPrefix") + " " : "") +
                  formatMoney(price.minor, currency.code, locale)}
              </span>
              {!currency.isBase && (
                <Badge variant={price.mode === "auto" ? "outline" : "secondary"}>
                  {t(`priceMode.${price.mode}`)}
                </Badge>
              )}
            </span>
          );
        },
      }),
      helper.accessor((p) => p.stock ?? undefined, {
        id: "stock",
        header: ({ column }) => (
          <SortButton
            label={t("columns.stock")}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()}
          />
        ),
        sortFn: byNumber,
        sortUndefined: "last",
        cell: ({ row }) => row.original.stock ?? t("stockUntracked"),
      }),
      helper.accessor((p) => STATUS_RANK[p.status], {
        id: "status",
        header: ({ column }) => (
          <SortButton
            label={t("columns.status")}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()}
          />
        ),
        sortFn: byNumber,
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "default" : "secondary"}>
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
      }),
      helper.display({
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <RowActions product={row.original} canUpdate={canUpdate} canDelete={canDelete} />
        ),
      }),
    ]);
  }, [t, locale, currency, canUpdate, canDelete]);

  // No sorting by default: rows keep the server's order (newest first).
  // Every column starts ascending; a third click goes back to that order.
  const table = useTable({
    features,
    columns,
    data: rows,
    sortDescFirst: false,
    getRowId: (row) => row.id,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  // Selected products that still exist (the list may have changed after a refresh), and how
  // many of them have prices of their own in this currency (the ones a bulk change touches)
  const selected = rows.filter((row) => rowSelection[row.id]);
  const manualCount = selected.filter((row) => {
    const price = row.prices[currency.code];
    return price !== undefined && (currency.isBase || price.mode !== "auto");
  }).length;

  return (
    <div className="flex flex-col gap-3">
      {(currencies.length > 1 || selected.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {currencies.length > 1 ? (
            <ButtonGroup aria-label={t("bulk.currency")}>
              {currencies.map((c) => (
                <Button
                  key={c.code}
                  type="button"
                  size="sm"
                  variant={c.code === currency.code ? "default" : "outline"}
                  aria-pressed={c.code === currency.code}
                  onClick={() => setCurrencyCode(c.code)}
                >
                  {c.code}
                </Button>
              ))}
            </ButtonGroup>
          ) : (
            <span />
          )}
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("bulk.toolbar")}>
              <span className="text-sm text-muted-foreground">{t("bulk.selected", { count: selected.length })}</span>
              {!currency.isBase && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={currency.rate === null}
                  onClick={() => setBulk("auto")}
                >
                  {t("bulk.setAuto")}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => setBulk("adjust")}>
                {t("bulk.adjust")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRowSelection({})}>
                {t("bulk.clear")}
              </Button>
            </div>
          )}
        </div>
      )}
      {!currency.isBase && (
        <p className="text-sm text-muted-foreground">
          {currency.rate === null
            ? t("bulk.noRate", { currency: currency.code })
            : t("bulk.rateInfo", { base: baseCurrency.code, rate: currency.rate, currency: currency.code })}
        </p>
      )}

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
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.original.id} data-state={row.getIsSelected() ? "selected" : undefined}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={COLUMN_CLASS[cell.column.id]}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {canUpdate && (
        <BulkPricesDialog
          mode={bulk}
          onOpenChange={(open) => !open && setBulk(null)}
          productIds={selected.map((row) => row.id)}
          manualCount={manualCount}
          currency={currency}
          baseCode={baseCurrency.code}
          onDone={() => setRowSelection({})}
        />
      )}
    </div>
  );
}

function RowActions({
  product,
  canUpdate,
  canDelete,
}: {
  product: ProductRow;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("Products");
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions.menu", { name: product.name })}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem render={<Link href={`/dashboard/products/${product.id}/edit`} />}>
            {canUpdate ? <PencilIcon /> : <EyeIcon />}
            {canUpdate ? t("actions.edit") : t("actions.view")}
          </DropdownMenuItem>
          {product.publicUrl && (
            <DropdownMenuItem
              render={<a href={product.publicUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {t("actions.viewInStore")}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon />
                {t("actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <DeleteProductDialog
          id={product.id}
          name={product.name}
          open={deleting}
          onOpenChange={setDeleting}
        />
      )}
    </>
  );
}
