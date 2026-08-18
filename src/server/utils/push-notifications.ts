import crypto from "node:crypto";
import http2 from "node:http2";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { userPushTokens } from "@/server/db/schema";

type DatabaseClient = typeof db;

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
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
  return APNS_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
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

  const signature = signer.sign(apnsPrivateKey());
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

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
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
    console.info("APNs push skipped", {
      reason: "no_active_tokens",
      userCount: uniqueUserIds.length,
      title: payload.title,
    });
    return;
  }

  console.info("APNs push sending", {
    userCount: uniqueUserIds.length,
    tokenCount: tokens.length,
    title: payload.title,
  });

  const jwt = createApnsJwt();
  const invalidTokens: string[] = [];
  let successCount = 0;

  await Promise.all(
    tokens.map(async ({ token }) => {
      const response = await sendApnsRequest(token, jwt, payload);

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

  await revokeTokens(invalidTokens, database);

  console.info("APNs push finished", {
    title: payload.title,
    successCount,
    revokedTokenCount: invalidTokens.length,
  });
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

  const jwt = createApnsJwt();
  const invalidTokens: string[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      const response = await sendBackgroundApnsRequest(token, jwt, payload);

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
