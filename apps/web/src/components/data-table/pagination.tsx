"use client";

import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The shadcn data-table pagination: rows per page, "Page X of Y", first / previous / next / last. */
export function Pagination({
  summary,
  pageIndex,
  pageCount,
  pageSize,
  pageSizes,
  onPageChange,
  onPageSizeChange,
}: {
  /** left side, e.g. "120 orders" */
  summary: React.ReactNode;
  /** 0-based */
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  pageSizes: readonly number[];
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const t = useTranslations("DataTable.pagination");
  const last = Math.max(pageCount - 1, 0);
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < last;

  return (
    <nav aria-label={t("label")} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
      <div className="text-muted-foreground">{summary}</div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t("rowsPerPage")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => typeof value === "string" && onPageSizeChange(Number(value))}
          >
            <SelectTrigger size="sm" className="w-18" aria-label={t("rowsPerPage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="font-medium tabular-nums">{t("page", { page: pageIndex + 1, pages: last + 1 })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:inline-flex"
            aria-label={t("first")}
            disabled={!canPrevious}
            onClick={() => onPageChange(0)}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("previous")}
            disabled={!canPrevious}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("next")}
            disabled={!canNext}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:inline-flex"
            aria-label={t("last")}
            disabled={!canNext}
            onClick={() => onPageChange(last)}
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </nav>
  );
}
