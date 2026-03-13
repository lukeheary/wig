import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { db } from "@/server/db";

type Database = typeof db;

export async function ensureDbUser(
  database: Database,
  userId: string
) {
  const existingUser = await database.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (existingUser) {
    return existingUser;
  }

  const clerk = await clerkClient();
  const clerkUser = await clerk.users.getUser(userId);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  if (!primaryEmail) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to resolve user email from Clerk",
    });
  }

  const normalizedEmail = primaryEmail.toLowerCase().trim();
  const existingUserByEmail = await database.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (existingUserByEmail && existingUserByEmail.id !== userId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "An account with this email already exists",
    });
  }

  const generatedUsername =
    clerkUser.username?.toLowerCase().trim() || `user_${userId.slice(-8)}`;

  const [createdUser] = await database
    .insert(users)
    .values({
      id: userId,
      email: normalizedEmail,
      username: generatedUsername,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      avatarImageUrl: clerkUser.imageUrl,
      isOnboarding: false,
    })
    .onConflictDoNothing()
    .returning();

  return (
    createdUser ??
    database.query.users.findFirst({
      where: eq(users.id, userId),
    })
  );
}
