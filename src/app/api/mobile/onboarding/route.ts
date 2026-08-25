import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { isReservedUsername } from "@/lib/reserved-usernames";
import { isAtLeastMinimumAge, isValidIsoDate } from "@/lib/age-requirement";
import {
  enforceMobileContentCreation,
  mobileContentModerationErrorResponse,
} from "@/app/api/mobile/content-moderation";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
function isValidDateOfBirth(value: string): boolean {
  return isValidIsoDate(value) && isAtLeastMinimumAge(value);
}

function preferredOnboardingUsername(
  username: string | null | undefined
): string {
  if (!username) {
    return "";
  }

  return username.startsWith("user_") ? "" : username;
}

function hasCompletedMobileProfile(user: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  city: string | null;
  state: string | null;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: string | Date | null;
}): boolean {
  return Boolean(
    user.firstName &&
    user.lastName &&
    user.username &&
    !user.username.startsWith("user_") &&
    user.city &&
    user.state &&
    user.gender &&
    user.dateOfBirth
  );
}

function onboardingDebugPayload(input: {
  reason: string;
  userId: string;
  matchedUserId?: string | null;
  matchedByEmail?: boolean;
}) {
  return {
    reason: input.reason,
    userId: input.userId,
    matchedUserId: input.matchedUserId ?? null,
    matchedByEmail: input.matchedByEmail ?? false,
  };
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
      const hasCompletedProfile = hasCompletedMobileProfile(existingUser);
      const isOnboarding = existingUser.isOnboarding && !hasCompletedProfile;

      if (existingUser.isOnboarding && hasCompletedProfile) {
        await db
          .update(users)
          .set({
            isOnboarding: false,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }

      return NextResponse.json({
        isOnboarding,
        firstName: existingUser.firstName ?? "",
        lastName: existingUser.lastName ?? "",
        username: isOnboarding
          ? preferredOnboardingUsername(existingUser.username)
          : existingUser.username,
        city: existingUser.city ?? "",
        state: existingUser.state ?? "",
        gender: existingUser.gender,
        dateOfBirth: existingUser.dateOfBirth,
        avatarImageUrl: existingUser.avatarImageUrl,
        debug: onboardingDebugPayload({
          reason: isOnboarding
            ? "matched_user_id_incomplete"
            : "matched_user_id_complete",
          userId,
          matchedUserId: existingUser.id,
        }),
      });
    }

    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find(
        (email) => email.id === clerkUser.primaryEmailAddressId
      )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
    const normalizedEmail = primaryEmail?.toLowerCase().trim();
    const existingUserByEmail = normalizedEmail
      ? await db.query.users.findFirst({
          where: eq(users.email, normalizedEmail),
        })
      : null;

    return NextResponse.json({
      isOnboarding: true,
      firstName: clerkUser.firstName ?? existingUserByEmail?.firstName ?? "",
      lastName: clerkUser.lastName ?? existingUserByEmail?.lastName ?? "",
      username: preferredOnboardingUsername(clerkUser.username),
      city: existingUserByEmail?.city ?? "",
      state: existingUserByEmail?.state ?? "",
      gender: existingUserByEmail?.gender ?? null,
      dateOfBirth: existingUserByEmail?.dateOfBirth ?? null,
      avatarImageUrl: clerkUser.hasImage ? clerkUser.imageUrl : null,
      debug: onboardingDebugPayload({
        reason: existingUserByEmail
          ? "no_user_id_match_but_email_exists"
          : "no_user_id_match",
        userId,
        matchedUserId: existingUserByEmail?.id,
        matchedByEmail: Boolean(existingUserByEmail),
      }),
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
      firstName?: string;
      lastName?: string;
      username?: string;
      city?: string;
      state?: string;
      gender?: "male" | "female" | "other";
      dateOfBirth?: string;
    };

    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    const normalizedUsername = body.username?.trim().toLowerCase() ?? "";
    const city = body.city?.trim() ?? "";
    const state = body.state?.trim().toUpperCase() ?? "";
    const gender = body.gender;
    const dateOfBirth = body.dateOfBirth?.trim() ?? "";

    await enforceMobileContentCreation(userId, [
      { field: "firstName", value: firstName },
      { field: "lastName", value: lastName },
      { field: "username", value: normalizedUsername },
    ]);

    if (
      !firstName ||
      !lastName ||
      firstName.length > 100 ||
      lastName.length > 100
    ) {
      return NextResponse.json(
        { error: "Please enter your first and last name" },
        { status: 400 }
      );
    }

    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3-20 characters and contain only letters, numbers, and underscores",
        },
        { status: 400 }
      );
    }

    if (isReservedUsername(normalizedUsername)) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    if (!city || city.length > 100 || state.length !== 2) {
      return NextResponse.json(
        { error: "Please select your city" },
        { status: 400 }
      );
    }

    if (!gender || !["male", "female", "other"].includes(gender)) {
      return NextResponse.json(
        { error: "Please select your gender" },
        { status: 400 }
      );
    }

    if (!isValidDateOfBirth(dateOfBirth)) {
      return NextResponse.json(
        { error: "You must be at least 13 years old to use WIG" },
        { status: 400 }
      );
    }

    const existingUserWithUsername = await db.query.users.findFirst({
      where: and(eq(users.username, normalizedUsername), ne(users.id, userId)),
    });

    if (existingUserWithUsername) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
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

    const savedUsers = !existingUser
      ? await db
          .insert(users)
          .values({
            id: userId,
            email: normalizedEmail,
            username: normalizedUsername,
            firstName,
            lastName,
            city,
            state,
            gender,
            avatarImageUrl: clerkUser.hasImage ? clerkUser.imageUrl : null,
            dateOfBirth,
            isOnboarding: false,
          })
          .returning()
      : await db
          .update(users)
          .set({
            firstName,
            lastName,
            username: normalizedUsername,
            city,
            state,
            gender,
            dateOfBirth,
            updatedAt: new Date(),
            isOnboarding: false,
          })
          .where(eq(users.id, userId))
          .returning();

    const savedUser = savedUsers[0];

    if (!savedUser || !hasCompletedMobileProfile(savedUser)) {
      console.error("Mobile onboarding persistence verification failed", {
        userId,
        savedUserId: savedUser?.id ?? null,
      });
      return NextResponse.json(
        { error: "Unable to save your profile. Please try again." },
        { status: 500 }
      );
    }

    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        isOnboarding: false,
      },
    });

    if (clerkUser.firstName !== firstName || clerkUser.lastName !== lastName) {
      await clerk.users.updateUser(userId, { firstName, lastName });
    }

    return NextResponse.json({
      isOnboarding: savedUser.isOnboarding,
      firstName: savedUser.firstName ?? "",
      lastName: savedUser.lastName ?? "",
      username: savedUser.username,
      city: savedUser.city ?? "",
      state: savedUser.state ?? "",
      gender: savedUser.gender,
      dateOfBirth: savedUser.dateOfBirth,
      avatarImageUrl: savedUser.avatarImageUrl,
    });
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;

    console.error("Mobile onboarding submit error:", error);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      username?: string;
      city?: string;
      state?: string;
      gender?: "male" | "female" | "other";
      dateOfBirth?: string;
    };

    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    const normalizedUsername = body.username?.trim().toLowerCase() ?? "";
    const city = body.city?.trim() ?? "";
    const state = body.state?.trim().toUpperCase() ?? "";
    const gender = body.gender;
    const dateOfBirth = body.dateOfBirth?.trim() ?? "";

    await enforceMobileContentCreation(userId, [
      { field: "firstName", value: firstName },
      { field: "lastName", value: lastName },
      { field: "username", value: normalizedUsername },
    ]);

    if (
      !firstName ||
      !lastName ||
      firstName.length > 100 ||
      lastName.length > 100
    ) {
      return NextResponse.json(
        { error: "Please enter your first and last name" },
        { status: 400 }
      );
    }

    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3-20 characters and contain only letters, numbers, and underscores",
        },
        { status: 400 }
      );
    }

    if (isReservedUsername(normalizedUsername)) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    if (!city || city.length > 100 || state.length !== 2) {
      return NextResponse.json(
        { error: "Please select your city" },
        { status: 400 }
      );
    }

    if (!gender || !["male", "female", "other"].includes(gender)) {
      return NextResponse.json(
        { error: "Please select your gender" },
        { status: 400 }
      );
    }

    if (!isValidDateOfBirth(dateOfBirth)) {
      return NextResponse.json(
        { error: "You must be at least 13 years old to use WIG" },
        { status: 400 }
      );
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existingUserWithUsername = await db.query.users.findFirst({
      where: and(eq(users.username, normalizedUsername), ne(users.id, userId)),
    });
    if (existingUserWithUsername) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    const shouldUpdateClerkName =
      existingUser.firstName !== firstName ||
      existingUser.lastName !== lastName;
    const clerk = await clerkClient();

    if (shouldUpdateClerkName) {
      await clerk.users.updateUser(userId, { firstName, lastName });
    }

    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          firstName,
          lastName,
          username: normalizedUsername,
          city,
          state,
          gender,
          dateOfBirth,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser || !hasCompletedMobileProfile(updatedUser)) {
        throw new Error("Mobile profile persistence verification failed");
      }

      return NextResponse.json({
        isOnboarding: false,
        firstName: updatedUser.firstName ?? "",
        lastName: updatedUser.lastName ?? "",
        username: updatedUser.username,
        city: updatedUser.city ?? "",
        state: updatedUser.state ?? "",
        gender: updatedUser.gender,
        dateOfBirth: updatedUser.dateOfBirth,
        avatarImageUrl: updatedUser.avatarImageUrl,
      });
    } catch (error) {
      if (shouldUpdateClerkName) {
        try {
          await clerk.users.updateUser(userId, {
            firstName: existingUser.firstName ?? "",
            lastName: existingUser.lastName ?? "",
          });
        } catch (rollbackError) {
          console.error("Mobile profile Clerk rollback error:", rollbackError);
        }
      }

      throw error;
    }
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;

    console.error("Mobile profile update error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
