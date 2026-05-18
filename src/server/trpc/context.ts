import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth, verifyToken } from "@clerk/nextjs/server";
import { db } from "../db";

type RequestAuth = {
  userId: string | null;
};

async function getBearerAuth(
  req?: FetchCreateContextFnOptions["req"]
): Promise<RequestAuth | null> {
  const authorizationHeader = req?.headers.get("authorization");

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    return {
      userId: typeof payload.sub === "string" ? payload.sub : null,
    };
  } catch {
    return null;
  }
}

export async function createContext(opts?: FetchCreateContextFnOptions) {
  const authObj = (await getBearerAuth(opts?.req)) ?? (await auth());

  return {
    auth: authObj,
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
