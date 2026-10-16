"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type { SortDirection } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A sortable column header: the label plus the current direction. */
export function SortButton({
  label,
  sorted,
  onClick,
  className,
}: {
  label: string;
  sorted: false | SortDirection;
  onClick: ((event: unknown) => void) | undefined;
  className?: string;
}) {
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <Button variant="ghost" size="sm" className={cn("-ml-2.5", className)} onClick={onClick}>
      {label}
      <Icon data-icon="inline-end" className={sorted ? undefined : "text-muted-foreground"} />
    </Button>
  );
}
