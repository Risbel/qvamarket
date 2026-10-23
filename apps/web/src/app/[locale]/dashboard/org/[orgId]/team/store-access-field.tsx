"use client";

import { useTranslations } from "next-intl";
import type { StoreAccessValues } from "@/lib/validation/team";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription, FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PlanBadge } from "@/components/plans/plan-badge";
import { useHasFeature } from "@/components/plans/plan-provider";

export type StoreOption = { id: string; name: string };

/**
 * Which stores a member can open: all (also future ones) or only the ticked ones. `stores` =
 * the stores the editor can open (only those can be given); "All stores" is offered only to
 * an editor who has it. The server checks both again.
 */
export function StoreAccessField({
  id,
  value,
  onChange,
  stores,
  allowAll,
  error,
  disabled,
}: {
  id: string;
  value: StoreAccessValues;
  onChange: (value: StoreAccessValues) => void;
  stores: StoreOption[];
  allowAll: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Team.storeAccess");
  // choosing some stores is a plan feature ("All stores" is always possible)
  const perStore = useHasFeature("storeAccess");

  function toggle(storeId: string, checked: boolean) {
    const storeIds = checked ? [...value.storeIds, storeId] : value.storeIds.filter((s) => s !== storeId);
    onChange({ all: false, storeIds });
  }

  return (
    <FieldSet data-invalid={Boolean(error) || undefined}>
      <FieldLegend variant="label">{t("label")}</FieldLegend>
      <RadioGroup
        value={value.all ? "all" : "some"}
        disabled={disabled}
        onValueChange={(next) => onChange({ all: next === "all", storeIds: value.storeIds })}
        className="gap-2"
      >
        <label htmlFor={`${id}-all`} className="flex items-start gap-2 text-sm has-disabled:opacity-60">
          <RadioGroupItem value="all" id={`${id}-all`} disabled={disabled || !allowAll} className="mt-0.5" />
          <span>
            <span className="font-medium">{t("all")}</span>
            <span className="block text-muted-foreground">{t("allHelp")}</span>
          </span>
        </label>
        <label htmlFor={`${id}-some`} className="flex items-start gap-2 text-sm has-disabled:opacity-60">
          <RadioGroupItem value="some" id={`${id}-some`} disabled={disabled || (!perStore && value.all)} className="mt-0.5" />
          <span className="font-medium">{t("some")}</span>
          <PlanBadge feature="storeAccess" />
        </label>
      </RadioGroup>
      {!value.all && (
        <ul className="flex flex-col gap-2 rounded-md border p-3">
          {stores.map((store) => {
            const boxId = `${id}-store-${store.id}`;
            return (
              <li key={store.id}>
                <label htmlFor={boxId} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={boxId}
                    checked={value.storeIds.includes(store.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => toggle(store.id, checked === true)}
                  />
                  {store.name}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!allowAll && <FieldDescription>{t("onlyYours")}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  );
}

