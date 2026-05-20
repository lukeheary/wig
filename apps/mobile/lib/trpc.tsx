import { PropsWithChildren, useMemo, useState } from "react";
import { useAuth } from "@clerk/expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { mobileEnv } from "./env";

export const trpc: any = createTRPCReact<any>();

function getTrpcUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/trpc`;
}

export function AppProviders({ children }: PropsWithChildren) {
  const { getToken } = useAuth();
  const [queryClient] = useState(() => new QueryClient());
  const trpcClient = useMemo(
    () =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: getTrpcUrl(mobileEnv.apiUrl),
          transformer: superjson,
          async headers() {
            const token = await getToken();

            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
    [getToken]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
