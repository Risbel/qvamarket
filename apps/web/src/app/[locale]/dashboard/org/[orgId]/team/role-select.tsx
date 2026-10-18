"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type RoleOption = { key: string; name: string; description: string | null };

/** A company role picker (only the roles the current member may give). */
export function RoleSelect({
  id,
  value,
  onChange,
  roles,
  invalid,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (key: string) => void;
  roles: RoleOption[];
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("Team");
  const names = new Map(roles.map((role) => [role.key, role.name]));
  return (
    <Select value={value || null} disabled={disabled} onValueChange={(key) => typeof key === "string" && onChange(key)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue>{(key: string | null) => (key && names.get(key)) || t("form.rolePlaceholder")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.key} value={role.key}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The chosen role's description, under the picker. */
export function roleDescription(roles: RoleOption[], key: string) {
  return roles.find((role) => role.key === key)?.description ?? null;
}
