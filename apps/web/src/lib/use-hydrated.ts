import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false during SSR and until React has hydrated, true afterwards.
 * Forms use it to keep the submit button disabled until their onSubmit handler is
 * attached: a native submit before hydration would send credentials in the URL (GET).
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
