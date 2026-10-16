"use client";

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
import { ExternalLinkIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { SortButton } from "@/components/data-table/sort-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DeleteProductDialog } from "./delete-product-dialog";

type ProductStatus = "draft" | "active" | "archived";

export type ProductRow = {
  id: string;
  name: string;
  status: ProductStatus;
  categoryName: string | null;
  /** Lowest regular price for 1 unit in the default currency; null = none. */
  priceMinor: number | null;
  variantCount: number;
  /** Sum of the variants' stock; null = some variant does not track it. */
  stock: number | null;
  imageUrl: string | null;
  /** Storefront URL of the product; null when it is not public. */
  publicUrl: string | null;
};

const features = tableFeatures({
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
  image: "w-14",
  actions: "w-12 text-right",
};

export function ProductsTable({
  rows,
  currency,
  canUpdate,
  canDelete,
}: {
  rows: ProductRow[];
  currency: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("Products");
  const locale = useLocale();

  const columns = useMemo(() => {
    // Locale-aware, ignores case and accents ("árbol" next to "Arbol"), numbers in order ("Talla 2" < "Talla 10")
    const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
    const byText: RowSortFn = (a, b, id) =>
      collator.compare(a.getValue<string>(id), b.getValue<string>(id));

    return helper.columns([
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
        cell: ({ row }) =>
          canUpdate ? (
            <Link
              href={`/dashboard/products/${row.original.id}/edit`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
          ) : (
            <span className="font-medium">{row.original.name}</span>
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
      helper.accessor((p) => p.priceMinor ?? undefined, {
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
          if (p.priceMinor === null) return t("noPrice");
          return (
            (p.variantCount > 1 ? t("fromPrefix") + " " : "") +
            formatMoney(p.priceMinor, currency, locale)
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
  const table = useTable({ features, columns, data: rows, sortDescFirst: false });

  return (
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
          <TableRow key={row.original.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={COLUMN_CLASS[cell.column.id]}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

  if (!canUpdate && !canDelete && !product.publicUrl) return null;

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
          {canUpdate && (
            <DropdownMenuItem render={<Link href={`/dashboard/products/${product.id}/edit`} />}>
              <PencilIcon />
              {t("actions.edit")}
            </DropdownMenuItem>
          )}
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
              {(canUpdate || product.publicUrl) && <DropdownMenuSeparator />}
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
