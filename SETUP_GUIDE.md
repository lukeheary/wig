# Complete Setup Guide for LocalSocialCalendar

This guide provides all the code and detailed instructions to complete the LocalSocialCalendar application.

## Table of Contents

1. [Environment Setup](#1-environment-setup)
2. [Clerk Middleware](#2-clerk-middleware)
3. [Clerk Webhook](#3-clerk-webhook)
4. [tRPC Infrastructure](#4-trpc-infrastructure)
5. [API Routers](#5-api-routers)
6. [Frontend Setup](#6-frontend-setup)
7. [Utility Functions](#7-utility-functions)
8. [Components](#8-components)
9. [Pages](#9-pages)
10. [Seed Script](#10-seed-script)
11. [Testing](#11-testing)

---

## 1. Environment Setup

### Step 1.1: Create Neon Database

1. Go to [https://neon.tech](https://neon.tech)
2. Click "Sign Up" or "Sign In"
3. Create a new project
4. Name it "wig" or similar
5. Copy the connection string (looks like: `postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`)
6. Go to Settings → Connection Pooling and enable it

### Step 1.2: Set Up Clerk

1. Go to [https://clerk.com](https://clerk.com)
2. Create a new application
3. Choose "Email" and "Google" as sign-in methods (or your preference)
4. Go to API Keys and copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`

### Step 1.3: Create `.env.local`

Create a file at `/Users/lukeheary/Documents/Coding/SocialCal/.env.local`:

```bash
# Database
DATABASE_URL="YOUR_NEON_CONNECTION_STRING_HERE"

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_YOUR_KEY_HERE"
CLERK_SECRET_KEY="sk_test_YOUR_KEY_HERE"
CLERK_WEBHOOK_SECRET="whsec_YOUR_WEBHOOK_SECRET_HERE"

# Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/"

# App Configuration
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Step 1.4: Generate and Run Migrations

```bash
# Generate migration files
npm run db:generate

# Apply migrations to database
npm run db:migrate

# (Optional) View database in Drizzle Studio
npm run db:studio
```

---

## 2. Clerk Middleware

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

**What this does:**
- Protects all routes except sign-in, sign-up, and webhooks
- Uses Clerk's middleware to check authentication
- Runs on all pages and API routes

---

## 3. Clerk Webhook

### Step 3.1: Create Webhook Handler

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/app/api/webhooks/clerk/route.ts`:

```typescript
import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error("Missing CLERK_WEBHOOK_SECRET environment variable");
  }

  // Get headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing svix headers", { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify webhook
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error: Verification failed", { status: 400 });
  }

  // Handle the event
  const eventType = evt.type;

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    await db
      .insert(users)
      .values({
        id,
        email: email_addresses[0].email_address,
        firstName: first_name,
        lastName: last_name,
        imageUrl: image_url,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: email_addresses[0].email_address,
          firstName: first_name,
          lastName: last_name,
          imageUrl: image_url,
          updatedAt: new Date(),
        },
      });

    console.log(`✅ User ${id} synced to database`);
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;
    if (id) {
      await db.delete(users).where(eq(users.id, id));
      console.log(`✅ User ${id} deleted from database`);
    }
  }

  return new Response("", { status: 200 });
}
```

### Step 3.2: Configure Clerk Webhook

1. In Clerk Dashboard, go to "Webhooks"
2. Click "Add Endpoint"
3. For local development, you'll need to use a tool like ngrok:
   ```bash
   npx ngrok http 3000
   ```
   Then use the ngrok URL: `https://YOUR-NGROK-URL.ngrok.io/api/webhooks/clerk`
4. For production, use: `https://your-domain.com/api/webhooks/clerk`
5. Subscribe to these events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
6. Copy the "Signing Secret" and add it to `.env.local` as `CLERK_WEBHOOK_SECRET`

---

## 4. tRPC Infrastructure

### Step 4.1: tRPC Initialization

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/server/trpc/init.ts`:

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import { type Context } from "./context";
import superjson from "superjson";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure - requires authentication
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      ...ctx,
      auth: { ...ctx.auth, userId: ctx.auth.userId }, // Type narrowing
    },
  });
});
```

### Step 4.2: tRPC Context

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/server/trpc/context.ts`:

```typescript
import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@clerk/nextjs/server";
import { db } from "../db";

export async function createContext(opts?: FetchCreateContextFnOptions) {
  const authObj = await auth();

  return {
    auth: authObj,
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

### Step 4.3: Root Router

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/server/trpc/root.ts`:

```typescript
import { router } from "./init";
import { businessRouter } from "./routers/business";
import { eventRouter } from "./routers/event";
import { friendsRouter } from "./routers/friends";

export const appRouter = router({
  business: businessRouter,
  event: eventRouter,
  friends: friendsRouter,
});

export type AppRouter = typeof appRouter;
```

---

## 5. API Routers

### Step 5.1: Business Router

Create `/Users/lukeheary/Documents/Coding/SocialCal/src/server/trpc/routers/business.ts`:

```typescript
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../init";
import { businesses, follows } from "../../db/schema";
import { eq, and, desc, or, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const businessRouter = router({
  createBusiness: protectedProcedure
    .input(
      z.object({
        slug: z
          .string()
          .min(3)
          .max(100)
          .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        city: z.string().min(1).max(100),
        state: z.string().length(2, "State must be 2-letter code"),
        website: z.string().url().optional().or(z.literal("")),
        instagram: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if slug already exists
      const existing = await ctx.db.query.businesses.findFirst({
        where: eq(businesses.slug, input.slug),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A business with this slug already exists",
        });
      }

      const [business] = await ctx.db
        .insert(businesses)
        .values({
          ...input,
          createdByUserId: ctx.auth.userId,
        })
        .returning();

      return business;
    }),

  getBusinessBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const business = await ctx.db.query.businesses.findFirst({
        where: eq(businesses.slug, input.slug),
        with: {
          createdBy: true,
          follows: true,
        },
      });

      if (!business) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Business not found",
        });
      }

      return business;
    }),

  listBusinesses: publicProcedure
    .input(
      z.object({
        city: z.string().optional(),
        state: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.city) conditions.push(eq(businesses.city, input.city));
      if (input.state) conditions.push(eq(businesses.state, input.state));
      if (input.search) {
        conditions.push(
          or(
            like(businesses.name, `%${input.search}%`),
            like(businesses.description, `%${input.search}%`)
          )!
        );
      }

      const results = await ctx.db.query.businesses.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(businesses.createdAt)],
        with: {
          follows: true,
        },
      });

      return results;
    }),

  followBusiness: protectedProcedure
    .input(z.object({ businessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if already following
      const existing = await ctx.db.query.follows.findFirst({
        where: and(
          eq(follows.userId, ctx.auth.userId),
          eq(follows.businessId, input.businessId)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already following this business",
        });
      }

      const [follow] = await ctx.db
        .insert(follows)
        .values({
          userId: ctx.auth.userId,
          businessId: input.businessId,
        })
        .returning();

      return follow;
    }),

  unfollowBusiness: protectedProcedure
    .input(z.object({ businessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(follows)
        .where(
          and(
            eq(follows.userId, ctx.auth.userId),
            eq(follows.businessId, input.businessId)
          )
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not following this business",
        });
      }

      return { success: true };
    }),

  listFollowedBusinesses: protectedProcedure.query(async ({ ctx }) => {
    const followedBusinesses = await ctx.db.query.follows.findMany({
      where: eq(follows.userId, ctx.auth.userId),
      with: {
        business: {
          with: {
            follows: true,
          },
        },
      },
      orderBy: [desc(follows.createdAt)],
    });

    return followedBusinesses.map((f) => f.business);
  }),

  isFollowing: protectedProcedure
    .input(z.object({ businessId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const follow = await ctx.db.query.follows.findFirst({
        where: and(
          eq(follows.userId, ctx.auth.userId),
          eq(follows.businessId, input.businessId)
        ),
      });

      return !!follow;
    }),
});
```

This file is getting quite long. Would you like me to:

1. **Continue creating the remaining router files** (eventRouter and friendsRouter) in the next response
2. **Create a separate comprehensive file** with all remaining code
3. **Focus on specific parts** you'd like to implement first

The foundation is solid with:
- ✅ Complete database schema
- ✅ Drizzle configuration
- ✅ Environment setup
- ✅ Clerk middleware ready
- ✅ Clerk webhook handler ready
- ✅ tRPC infrastructure ready
- ✅ Business router complete

What would you like me to focus on next?