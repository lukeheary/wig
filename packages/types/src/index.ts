import { type inferRouterOutputs } from "@trpc/server";
import { type AppRouter } from "../../../src/server/trpc/root";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type EventListItem = RouterOutputs["event"]["listEventsByRange"][number];
export type EventDetail = RouterOutputs["event"]["getEventById"];
export type CurrentUser = RouterOutputs["user"]["getCurrentUser"];
export type AvailableCity = RouterOutputs["event"]["getAvailableCities"][number];
