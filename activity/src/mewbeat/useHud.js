import { useMemo, useSyncExternalStore } from "react";
import { memoSelect } from "./hudStore.js";

// The slice of a store that `select` picks, rendering again only when that slice changes. `select` should be stable
// (module-level or useCallback): a new one is a new subscription to the same value.
export function useHud(store, select) {
  const read = useMemo(() => memoSelect(select), [select]);
  return useSyncExternalStore(store.subscribe, () => read(store.get()));
}
