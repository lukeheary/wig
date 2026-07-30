import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";

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
    const {
      id,
      email_addresses,
      primary_email_address_id,
      username,
      first_name,
      last_name,
      image_url,
    } = evt.data;

    const primaryEmailAddress =
      email_addresses.find((email) => email.id === primary_email_address_id) ??
      email_addresses[0];
    const email = primaryEmailAddress?.email_address?.toLowerCase().trim();

    if (!email) {
      console.warn(`Skipping ${eventType} for user ${id}: missing email`);
      return new Response("", { status: 200 });
    }

    // Check if the user has a real image (Clerk default and OAuth proxy images should be ignored)
    // @ts-ignore - has_image might not be in the typings but is in the payload
    const hasRealImage = evt.data.has_image === true;
    const isClerkProxyImage =
      image_url?.includes("img.clerk.com") ||
      image_url?.includes("oauth_google") ||
      image_url?.includes("oauth_");
    const finalImageUrl = hasRealImage && !isClerkProxyImage ? image_url : null;

    const insertedUserId = await db.transaction(async (tx) => {
      // Serialize insert attempts for the same email so duplicate webhook deliveries
      // cannot create multiple rows when they arrive concurrently.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);

      const [existingUserById, existingUserByEmail] = await Promise.all([
        tx.query.users.findFirst({ where: eq(users.id, id) }),
        tx.query.users.findFirst({ where: eq(users.email, email) }),
      ]);

      // Ignore all extra events once the first row exists.
      if (existingUserById || existingUserByEmail) {
        console.log(
          `Skipping ${eventType} for Clerk user ${id}: user already exists for email ${email}`
        );
        return null;
      }

      let finalUsername = (username || `user_${id.slice(-8)}`)
        .toLowerCase()
        .trim();
      const usernameConflict = await tx.query.users.findFirst({
        where: eq(users.username, finalUsername),
      });

      if (usernameConflict) {
        const suffix = `_${id.slice(-8).toLowerCase()}`;
        finalUsername = `${finalUsername.slice(0, 50 - suffix.length)}${suffix}`;
      }
      const [createdUser] = await tx
        .insert(users)
        .values({
          id,
          email,
          username: finalUsername,
          firstName: first_name,
          lastName: last_name,
          avatarImageUrl: finalImageUrl,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });

      return createdUser?.id ?? null;
    });

    if (!insertedUserId) {
      return new Response("", { status: 200 });
    }

    // Set onboarding metadata only when we insert the very first row.
    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(id, {
      publicMetadata: {
        isOnboarding: true,
      },
    });

    console.log(`Created user ${id} in database`);
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
