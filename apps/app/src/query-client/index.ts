import { QueryClient } from "@tanstack/react-query";

/**
 * Freshness policy.
 *
 * This used to be refetchOnMount:false + refetchOnWindowFocus:false with no
 * staleTime, which is "cache forever": a list read once was never read again
 * for the life of the tab. Anything that changed outside this browser — a
 * client paying an invoice, a proposal being viewed, a colleague editing a
 * row — only appeared after a manual page reload. That is the bug people
 * describe as "the data does not update".
 *
 * The replacement refetches when a screen is mounted or the window is focused
 * again, but only once the data is older than staleTime. Flicking between two
 * screens costs nothing; coming back to the tab after a minute shows the truth.
 * Refetches are background ones — the cached rows stay on screen while they
 * run, so nothing flashes a spinner.
 *
 * Screens where a number changes without anyone touching this app (invoices,
 * proposals) add their own refetchInterval on top. Keep those at a minute or
 * slower: a poll faster than that buys nothing a focus refetch does not.
 */
const STALE_TIME = 30_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof Error) {
          if (
            error.message.includes("Failed to fetch") ||
            error.message.includes("NetworkError") ||
            error.message.includes("CORS")
          ) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export default queryClient;
