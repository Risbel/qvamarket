"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { categorySlug } from "@/lib/slug";
import { useHydrated } from "@/lib/use-hydrated";
import { createCategorySchema, type CategoryValues } from "@/lib/validation/catalog-settings";
import {
  createCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  setCategoryVisibilityAction,
  updateCategoryAction,
  type CatalogActionResult,
} from "@/server/catalog-actions";
import { useCan } from "@/components/permissions/permissions-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Category = {
  id: string;
  name: string;
  slug: string;
  isVisible: boolean;
  productCount: number;
};

/**
 * The category list. category:read sees it; create, update (reorder, show/hide, rename) and
 * delete each show their controls only when allowed (the actions check again).
 */
export function CategoriesManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("Categories");
  const can = useCan();
  const canCreate = can({ category: ["create"] });
  const canUpdate = can({ category: ["update"] });
  const canDelete = can({ category: ["delete"] });
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** `success`: the toast shown when it worked (none for reordering, which shows itself) */
  async function run(action: () => Promise<CatalogActionResult>, success?: string) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      if (success) toast.success(success);
    } else setError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    router.refresh();
    return result;
  }

  return (
    <div className="flex flex-col gap-6">
      {canCreate && (
        <CategoryForm mode="create" takenSlugs={categories.map((c) => c.slug)} onDone={() => router.refresh()} />
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {categories.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {categories.map((category, index) => (
            <li key={category.id} className="flex flex-col gap-2 p-3" data-category={category.slug}>
              {editing === category.id ? (
                <CategoryForm
                  mode="edit"
                  category={category}
                  takenSlugs={categories.filter((c) => c.id !== category.id).map((c) => c.slug)}
                  onDone={() => {
                    setEditing(null);
                    router.refresh();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {category.name}
                      {!category.isVisible && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t("hidden")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      #{category.slug} · {t("productCount", { count: category.productCount })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {canUpdate && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("moveUp", { name: category.name })}
                          disabled={!hydrated || busy || index === 0}
                          onClick={() => run(() => moveCategoryAction(category.id, "up"))}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("moveDown", { name: category.name })}
                          disabled={!hydrated || busy || index === categories.length - 1}
                          onClick={() => run(() => moveCategoryAction(category.id, "down"))}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!hydrated || busy}
                          onClick={() =>
                            run(
                              () => setCategoryVisibilityAction(category.id, !category.isVisible),
                              t(category.isVisible ? "toasts.hidden" : "toasts.shown", { name: category.name }),
                            )
                          }
                        >
                          {category.isVisible ? t("hide") : t("show")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={!hydrated || busy} onClick={() => setEditing(category.id)}>
                          {t("rename")}
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="outline" disabled={!hydrated || busy} onClick={() => setDeleting(category)}>
                        {t("delete")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleting && t("deleteConfirm", { name: deleting.name, count: deleting.productCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                await run(() => deleteCategoryAction(deleting.id), t("toasts.deleted", { name: deleting.name }));
                setDeleting(null);
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryForm({
  mode,
  category,
  takenSlugs,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  category?: Category;
  /** identifiers of the store's other categories, for the preview */
  takenSlugs: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Categories");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createCategorySchema(tv), [tv]);
  const form = useForm<CategoryValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: category?.name ?? "" },
  });

  // Preview of the identifier the server will generate from the name (same rule)
  const name = form.watch("name").trim();
  const preview = name === category?.name ? category.slug : categorySlug(name, takenSlugs);

  async function onSubmit(values: CategoryValues) {
    setFormError(null);
    const result =
      mode === "create"
        ? await createCategoryAction(values, locale)
        : await updateCategoryAction(category!.id, values, locale);
    if (result.ok) {
      toast.success(t(mode === "create" ? "toasts.created" : "toasts.saved", { name: values.name.trim() }));
      if (mode === "create") form.reset({ name: "" });
      onDone();
      return;
    }
    if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof CategoryValues, { message: messages[0] });
      }
    } else setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate aria-label={mode === "create" ? t("new") : t("rename")}>
      <FieldGroup className="gap-3">
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${mode}-${category?.id ?? "new"}-name`}>{t("name")}</FieldLabel>
              <Input
                {...field}
                id={`${mode}-${category?.id ?? "new"}-name`}
                placeholder={t("namePlaceholder")}
                aria-invalid={fieldState.invalid}
              />
              {name !== "" && <FieldDescription>{t("anchorPreview", { anchor: `#${preview}` })}</FieldDescription>}
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {formError && <FieldError>{formError}</FieldError>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!hydrated || form.formState.isSubmitting}>
            {mode === "create" ? t("create") : t("save")}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              {t("cancel")}
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}
