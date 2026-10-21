import type { ReactNode } from "react";
import { storeThemeCss, type StoreTheme } from "@/lib/store-theme";

/**
 * Dresses the whole page in a store's generated theme (see src/lib/store-theme.ts). The
 * variables go on `:root`, not on a wrapper, so portals (dialogs, menus, selects, toasts)
 * get them too. Fine because each store is its own host: no client navigation leaves it.
 */
export function StoreThemeProvider({ theme, children }: { theme: StoreTheme; children: ReactNode }) {
  return (
    <>
      <style>{storeThemeCss(theme)}</style>
      {children}
    </>
  );
}
