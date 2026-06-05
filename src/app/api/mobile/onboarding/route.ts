import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

const RESERVED_USERNAMES = new Set(["luke"]);
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const DATE_OF_BIRTH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOfBirth(value: string): boolean {
  if (!DATE_OF_BIRTH_PATTERN.test(value)) {
    return false;
  }

  const [yearString, monthString, dayString] = value.split("-");
  const year = Number.parseInt(yearString, 10);
  const month = Number.parseInt(monthString, 10);
  const day = Number.parseInt(dayString, 10);

  if (!year || !month || !day) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function preferredOnboardingUsername(username: string | null | undefined): string {
  if (!username) {
    return "";
  }

  return username.startsWith("user_") ? "" : username;
}

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (existingUser) {
      return NextResponse.json({
        isOnboarding: existingUser.isOnboarding,
        username: existingUser.isOnboarding
          ? preferredOnboardingUsername(existingUser.username)
          : existingUser.username,
        dateOfBirth: existingUser.dateOfBirth,
        avatarImageUrl: existingUser.avatarImageUrl,
      });
    }

    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(userId);

    return NextResponse.json({
      isOnboarding: true,
      username: preferredOnboardingUsername(clerkUser.username),
      dateOfBirth: null,
      avatarImageUrl: clerkUser.hasImage ? clerkUser.imageUrl : null,
    });
  } catch (error) {
    console.error("Mobile onboarding fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load onboarding state" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      username?: string;
      dateOfBirth?: string;
    };

    const normalizedUsername = body.username?.trim().toLowerCase() ?? "";
    const dateOfBirth = body.dateOfBirth?.trim() ?? "";

    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3-20 characters and contain only letters, numbers, and underscores",
        },
        { status: 400 }
      );
    }

    if (RESERVED_USERNAMES.has(normalizedUsername)) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
    }

    if (!isValidDateOfBirth(dateOfBirth)) {
      return NextResponse.json({ error: "Please enter a valid date of birth" }, { status: 400 });
    }

    const existingUserWithUsername = await db.query.users.findFirst({
      where: and(eq(users.username, normalizedUsername), ne(users.id, userId)),
    });

    if (existingUserWithUsername) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
    }

    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find(
        (email) => email.id === clerkUser.primaryEmailAddressId
      )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

    if (!primaryEmail) {
      return NextResponse.json(
        { error: "Unable to resolve user email from Clerk" },
        { status: 500 }
      );
    }

    const normalizedEmail = primaryEmail.toLowerCase().trim();
    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!existingUser) {
      const existingUserByEmail = await db.query.users.findFirst({
        where: eq(users.email, normalizedEmail),
      });

      if (existingUserByEmail && existingUserByEmail.id !== userId) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }

      await db.insert(users).values({
        id: userId,
        email: normalizedEmail,
        username: normalizedUsername,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        avatarImageUrl: clerkUser.hasImage ? clerkUser.imageUrl : null,
        dateOfBirth,
        isOnboarding: false,
      });
    } else {
      await db
        .update(users)
        .set({
          username: normalizedUsername,
          dateOfBirth,
          updatedAt: new Date(),
          isOnboarding: false,
        })
        .where(eq(users.id, userId));
    }

    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        isOnboarding: false,
      },
    });

    return NextResponse.json({
      isOnboarding: false,
      username: normalizedUsername,
      dateOfBirth,
    });
  } catch (error) {
    console.error("Mobile onboarding submit error:", error);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }
}
