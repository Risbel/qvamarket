"use client";

import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

export type FacetOption<TValue extends string> = {
  value: TValue;
  label: string;
  /** rows with this value (given by the caller, e.g. counted by the server) */
  count?: number;
};

/**
 * The shadcn data-table "faceted filter": a dashed button that lists the values of one
 * column with checkboxes; the chosen ones show as badges on the button. Several values = any
 * of them. Built on DropdownMenu (stays open while ticking) instead of Command.
 */
export function FacetedFilter<TValue extends string>({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FacetOption<TValue>[];
  selected: TValue[];
  onChange: (values: TValue[]) => void;
}) {
  const t = useTranslations("DataTable");
  const chosen = options.filter((option) => selected.includes(option.value));

  function toggle(value: TValue, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(value);
    else next.delete(value);
    // Keep the options' order, so the URL does not depend on the clicking order
    onChange(options.map((option) => option.value).filter((v) => next.has(v)));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="border-dashed" />}>
        <PlusCircleIcon data-icon="inline-start" />
        {title}
        {chosen.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
              {chosen.length}
            </Badge>
            <span className="hidden gap-1 lg:flex">
              {chosen.length > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {t("selected", { count: chosen.length })}
                </Badge>
              ) : (
                chosen.map((option) => (
                  <Badge key={option.value} variant="secondary" className="rounded-sm px-1 font-normal">
                    {option.label}
                  </Badge>
                ))
              )}
            </span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked)}
            >
              {option.label}
              {option.count !== undefined && (
                <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">{option.count}</span>
              )}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {chosen.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="justify-center" onClick={() => onChange([])}>
              {t("clearFilter")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
