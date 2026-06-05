import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { userPushTokens } from "@/server/db/schema";

const requestSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios"]),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = requestSchema.parse(await request.json());

    await db
      .insert(userPushTokens)
      .values({
        userId,
        token: body.token,
        platform: body.platform,
        updatedAt: new Date(),
        lastRegisteredAt: new Date(),
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: userPushTokens.token,
        set: {
          userId,
          platform: body.platform,
          updatedAt: new Date(),
          lastRegisteredAt: new Date(),
          revokedAt: null,
        },
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    console.error("Mobile push token registration error:", error);
    return NextResponse.json(
      { error: "Failed to register push token" },
      { status: 500 }
    );
  }
}
