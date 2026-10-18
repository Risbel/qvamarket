"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { useCan } from "@/components/permissions/permissions-provider";
import {
  RESOURCES,
  normalizePermissions,
  statement,
  type Action,
  type PermissionRequest,
  type Resource,
} from "@/lib/permissions";

export type PermissionValue = Record<string, string[]>;

/**
 * One row per resource with a checkbox per action it has. Checking any action ticks "read"
 * (you cannot edit what you cannot see), unticking "read" clears the row. Actions the
 * editor does not have are disabled: the server refuses granting them anyway.
 */
export function PermissionMatrix({
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  value: PermissionValue;
  onChange: (value: PermissionValue) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations("Roles");
  const can = useCan();

  function toggle(resource: Resource, action: Action, checked: boolean) {
    const actions = new Set(value[resource] ?? []);
    if (checked) actions.add(action);
    else if (action === "read") actions.clear();
    else actions.delete(action);
    onChange(normalizePermissions({ ...value, [resource]: [...actions] }) as PermissionValue);
  }

  const actionLabel = (resource: Resource, action: Action) =>
    t.has(`resources.${resource}.actions.${action}`)
      ? t(`resources.${resource}.actions.${action}`)
      : t(`actionNames.${action}`);

  return (
    <ul
      className="flex flex-col divide-y rounded-lg border data-invalid:border-destructive"
      data-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      {RESOURCES.map((resource) => {
        const granted = value[resource] ?? [];
        const labelId = `permission-${resource}`;
        return (
          <li key={resource} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5 sm:max-w-[55%]">
              <span id={labelId} className="text-sm font-medium">
                {t(`resources.${resource}.name`)}
              </span>
              <span className="text-xs text-muted-foreground">{t(`resources.${resource}.description`)}</span>
            </div>
            <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-x-4 gap-y-2">
              {statement[resource].map((action: Action) => {
                const id = `${labelId}-${action}`;
                const allowed = can({ [resource]: [action] } as PermissionRequest);
                return (
                  <label key={action} htmlFor={id} className="flex items-center gap-2 text-sm has-disabled:opacity-60">
                    <Checkbox
                      id={id}
                      checked={granted.includes(action)}
                      disabled={disabled || !allowed}
                      onCheckedChange={(checked) => toggle(resource, action, checked)}
                    />
                    {actionLabel(resource, action)}
                  </label>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
