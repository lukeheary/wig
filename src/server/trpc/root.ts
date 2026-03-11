import { router } from "./init";
import { placeRouter } from "./routers/place";
import { adminRouter } from "./routers/admin";
import { eventRouter } from "./routers/event";
import { friendsRouter } from "./routers/friends";
import { partnersRouter } from "./routers/partners";
import { userRouter } from "./routers/user";
import { categoryRouter } from "./routers/category";
import { supportRouter } from "./routers/support";

export const appRouter = router({
  place: placeRouter,
  admin: adminRouter,
  event: eventRouter,
  friends: friendsRouter,
  partners: partnersRouter,
  user: userRouter,
  category: categoryRouter,
  support: supportRouter,
});

export type AppRouter = typeof appRouter;
