import crypto from "node:crypto";
import http2 from "node:http2";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { allowsPushNotification } from "@/lib/notification-preferences";
import {
  userNotificationPreferences,
  userPushTokens,
} from "@/server/db/schema";

type DatabaseClient = typeof db;

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  collapseId?: string;
  expiresAt?: Date;
};

type BackgroundPushPayload = {
  data: Record<string, unknown>;
};

const APNS_KEY_ID = process.env.APNS_KEY_ID;
const APNS_TEAM_ID = process.env.APNS_TEAM_ID;
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY;
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID;
const APNS_USE_SANDBOX = process.env.APNS_USE_SANDBOX === "true";

function isConfigured() {
  return Boolean(
    APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY && APNS_BUNDLE_ID
  );
}

function apnsPrivateKey() {
  const value = APNS_PRIVATE_KEY?.trim() ?? "";
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;

  return unquoted.replace(/\\n/g, "\n");
}

function logPushError(message: string, error: unknown) {
  console.error(message, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function createApnsJwt() {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    throw new Error("Missing APNs signing configuration");
  }

  const header = {
    alg: "ES256",
    kid: APNS_KEY_ID,
  };
  const payload = {
    iss: APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign({
    key: apnsPrivateKey(),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsignedToken}.${base64url(signature)}`;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function revokeTokens(tokens: string[], database: DatabaseClient) {
  if (tokens.length === 0) {
    return;
  }

  await database
    .update(userPushTokens)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(userPushTokens.token, tokens));
}

async function sendApnsRequest(
  deviceToken: string,
  jwt: string,
  payload: PushPayload
) {
  const authority = APNS_USE_SANDBOX
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = http2.connect(authority);
    client.on("error", reject);
    client.setTimeout(10_000, () => {
      client.destroy();
      reject(new Error("APNs request timed out"));
    });

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
      ...(payload.collapseId ? { "apns-collapse-id": payload.collapseId } : {}),
      ...(payload.expiresAt
        ? {
            "apns-expiration": String(
              Math.floor(payload.expiresAt.getTime() / 1000)
            ),
          }
        : {}),
      "content-type": "application/json",
    });

    let responseBody = "";
    let status = 0;

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      const headerStatus = headers[http2.constants.HTTP2_HEADER_STATUS];
      status =
        typeof headerStatus === "number"
          ? headerStatus
          : Number(headerStatus ?? 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();
      resolve({ status, body: responseBody });
    });
    request.on("error", (error) => {
      client.close();
      reject(error);
    });

    request.end(
      JSON.stringify({
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: "default",
        },
        ...(payload.data ? { data: payload.data } : {}),
      })
    );
  });
}

async function sendBackgroundApnsRequest(
  deviceToken: string,
  jwt: string,
  payload: BackgroundPushPayload
) {
  const authority = APNS_USE_SANDBOX
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = http2.connect(authority);
    client.on("error", reject);

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_BUNDLE_ID!,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    });

    let responseBody = "";
    let status = 0;

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      const headerStatus = headers[http2.constants.HTTP2_HEADER_STATUS];
      status =
        typeof headerStatus === "number"
          ? headerStatus
          : Number(headerStatus ?? 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();
      resolve({ status, body: responseBody });
    });
    request.on("error", (error) => {
      client.close();
      reject(error);
    });

    request.end(
      JSON.stringify({
        aps: {
          "content-available": 1,
        },
        data: payload.data,
      })
    );
  });
}

export async function sendPushNotificationToUsers(
  userIds: string[],
  payload: PushPayload,
  database: DatabaseClient = db
) {
  if (!isConfigured() || userIds.length === 0) {
    console.info("APNs push skipped", {
      reason: !isConfigured() ? "missing_configuration" : "no_user_ids",
      userCount: userIds.length,
      title: payload.title,
    });
    return { successCount: 0 };
  }

  const uniqueUserIds = [...new Set(userIds)];
  let allowedUserIds: string[];
  try {
    const saved = await database.query.userNotificationPreferences.findMany({
      where: inArray(userNotificationPreferences.userId, uniqueUserIds),
      columns: { userId: true, preferences: true },
    });
    const preferencesByUser = new Map(
      saved.map((row) => [row.userId, row.preferences])
    );
    allowedUserIds = uniqueUserIds.filter((id) =>
      allowsPushNotification(preferencesByUser.get(id), payload.data)
    );
  } catch (error) {
    // Never send alerts against an unknown preference, or fail the action that
    // generated the notification. Saved in-app notifications are independent.
    logPushError(
      "APNs push skipped: notification preferences unavailable",
      error
    );
    return { successCount: 0 };
  }
  if (allowedUserIds.length === 0) return { successCount: 0 };
  const tokens = await database.query.userPushTokens.findMany({
    where: and(
      inArray(userPushTokens.userId, allowedUserIds),
      isNull(userPushTokens.revokedAt)
    ),
    columns: {
      token: true,
    },
  });

  if (tokens.length === 0) {
    console.info("APNs push skipped", {
      reason: "no_active_tokens",
      userCount: uniqueUserIds.length,
      title: payload.title,
    });
    return { successCount: 0 };
  }

  console.info("APNs push sending", {
    userCount: uniqueUserIds.length,
    tokenCount: tokens.length,
    title: payload.title,
  });

  let jwt: string;
  try {
    jwt = createApnsJwt();
  } catch (error) {
    // Push delivery is a best-effort side effect. A malformed or rotated APNs
    // key must not turn an already-committed RSVP (or other mutation) into a 500.
    logPushError(
      "APNs push skipped: signing failed; verify APNS_PRIVATE_KEY is the PEM contents of the Apple .p8 key",
      error
    );
    return { successCount: 0 };
  }
  const invalidTokens: string[] = [];
  let successCount = 0;

  await Promise.all(
    tokens.map(async ({ token }) => {
      let response: Awaited<ReturnType<typeof sendApnsRequest>>;
      try {
        response = await sendApnsRequest(token, jwt, payload);
      } catch (error) {
        logPushError("APNs push request failed", error);
        return;
      }

      if (response.status >= 200 && response.status < 300) {
        successCount += 1;
        return;
      }

      const shouldRevoke =
        response.status === 410 ||
        response.body.includes("BadDeviceToken") ||
        response.body.includes("Unregistered") ||
        response.body.includes("DeviceTokenNotForTopic");

      if (shouldRevoke) {
        invalidTokens.push(token);
      } else {
        console.error("APNs push failed", {
          status: response.status,
          body: response.body,
        });
      }
    })
  );

  try {
    await revokeTokens(invalidTokens, database);
  } catch (error) {
    logPushError("APNs token cleanup failed", error);
  }

  console.info("APNs push finished", {
    title: payload.title,
    successCount,
    revokedTokenCount: invalidTokens.length,
  });
  return { successCount };
}

export async function sendBackgroundPushToUsers(
  userIds: string[],
  payload: BackgroundPushPayload,
  database: DatabaseClient = db
) {
  if (!isConfigured() || userIds.length === 0) {
    return;
  }

  const uniqueUserIds = [...new Set(userIds)];
  const tokens = await database.query.userPushTokens.findMany({
    where: and(
      inArray(userPushTokens.userId, uniqueUserIds),
      isNull(userPushTokens.revokedAt)
    ),
    columns: {
      token: true,
    },
  });

  if (tokens.length === 0) {
    return;
  }

  let jwt: string;
  try {
    jwt = createApnsJwt();
  } catch (error) {
    logPushError(
      "APNs background push skipped: signing failed; verify APNS_PRIVATE_KEY is the PEM contents of the Apple .p8 key",
      error
    );
    return;
  }
  const invalidTokens: string[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      let response: Awaited<ReturnType<typeof sendBackgroundApnsRequest>>;
      try {
        response = await sendBackgroundApnsRequest(token, jwt, payload);
      } catch (error) {
        logPushError("APNs background push request failed", error);
        return;
      }

      if (response.status >= 200 && response.status < 300) {
        return;
      }

      const shouldRevoke =
        response.status === 410 ||
        response.body.includes("BadDeviceToken") ||
        response.body.includes("Unregistered") ||
        response.body.includes("DeviceTokenNotForTopic");

      if (shouldRevoke) {
        invalidTokens.push(token);
      } else {
        console.error("APNs background push failed", {
          status: response.status,
          body: response.body,
        });
      }
    })
  );

  await revokeTokens(invalidTokens, database);
}
