"use client";

import { Settings2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The shadcn data-table "View" menu: show or hide columns. */
export function ViewOptions({
  columns,
  onToggle,
}: {
  columns: { id: string; label: string; visible: boolean }[];
  onToggle: (id: string, visible: boolean) => void;
}) {
  const t = useTranslations("DataTable");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="ml-auto" />}>
        <Settings2Icon data-icon="inline-start" />
        {t("view")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("toggleColumns")}</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.visible}
              onCheckedChange={(checked) => onToggle(column.id, checked)}
            >
              {column.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
