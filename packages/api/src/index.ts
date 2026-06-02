import { QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { type AppRouter } from "../../../src/server/trpc/root";

export const trpc = createTRPCReact<AppRouter>();

export function createQueryClient() {
  return new QueryClient();
}

export function getTrpcUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/trpc`;
}
