import type { AppRouterClient } from "@justpingpong/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { ENV } from "../env.public";

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      // Toasts load on demand so they stay out of the game's bundle; queries run only on pages
      // whose shell has already loaded them.
      onError: (error, query) => {
        void import("sonner").then(({ toast }) =>
          toast.error(`Error: ${error.message}`, {
            action: {
              label: "retry",
              onClick: () => {
                query.invalidate();
              },
            },
          }),
        );
      },
    }),
  });
}

export const queryClient = createQueryClient();

export const link = new RPCLink({
  url: `${(ENV.VITE_SERVER_URL ?? "").replace(/\/$/, "")}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
