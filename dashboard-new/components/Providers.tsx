"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { ApiErrorException, tierOf } from "../lib/errors";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Retries are the transient-failure story: the toast tier says "auto-retrying"
  // and this is what makes that true. Inline and dialog codes are settled
  // answers, so retrying them only delays the surface.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) => count < 2 && (!(err instanceof ApiErrorException) || tierOf(err.detail.code) === "toast"),
            retryDelay: (n) => Math.min(8000, 1000 * 2 ** n),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { fontSize: "12px" } }} />
    </QueryClientProvider>
  );
}
