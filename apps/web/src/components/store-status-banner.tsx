import { useTranslations } from "next-intl";

/** Shown to the merchant while their store is not public (awaiting approval, or suspended). */
export function StoreStatusBanner({ status }: { status: "pending" | "suspended" }) {
  const t = useTranslations("Panel.status");
  return (
    <div
      role="status"
      className="bg-sky-50 px-4 py-2 text-center text-sm text-sky-950 dark:bg-sky-950 dark:text-sky-50"
    >
      {t(status)}
    </div>
  );
}
