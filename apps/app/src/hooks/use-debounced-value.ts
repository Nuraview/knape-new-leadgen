/**
 * Debounce a VALUE, for use in a React Query key.
 *
 * The existing lib/debounce.ts debounces a callback, which is right for
 * "save as you type" but cannot help a query key: putting raw input state into
 * `queryKey` fires a request per keystroke, and each response re-renders the
 * list underneath the caret. That is the reported ~1s typing lag on /leads —
 * the server answers /api/health in 3.6ms, so the cost was never round-trip
 * time, it was React re-rendering a large table on every character.
 *
 * 300ms: below roughly 250ms a fast typist still triggers most keystrokes, and
 * above ~400ms the results feel detached from the input.
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;
