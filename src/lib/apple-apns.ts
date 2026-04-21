// APNs HTTP/2 client for wallet silent pushes.
//
// Wallet push is a magic no-op: empty JSON body, no alert, just a signal to
// the device that it should hit the PassKit web service for new data. The
// device then calls GET /v1/passes/:type/:serial and we return the latest
// pass.json contents.
import { readFile } from "node:fs/promises";
import { connect, type ClientHttp2Session } from "node:http2";
import jwt from "jsonwebtoken";
import { config, appleEnabled } from "../config.js";
import { query } from "../db.js";

const APNS_HOST = "https://api.push.apple.com";

let cachedKey: string | null = null;
let cachedToken: { jwt: string; issuedAt: number } | null = null;

async function loadKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  cachedKey = await readFile(config.apple.apnsKeyPath, "utf8");
  return cachedKey;
}

// Apple requires APNs JWT refresh at most every 20 min, at least every 60.
// We sit in the middle.
async function apnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.issuedAt < 30 * 60) {
    return cachedToken.jwt;
  }
  const key = await loadKey();
  const token = jwt.sign({ iss: config.apple.apnsTeamId, iat: now }, key, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: config.apple.apnsKeyId },
  });
  cachedToken = { jwt: token, issuedAt: now };
  return token;
}

// Long-lived HTTP/2 session. Re-open on close.
let session: ClientHttp2Session | null = null;

function getSession(): ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  session = connect(APNS_HOST);
  session.on("error", (err) => {
    console.error("[apns] session error:", err);
  });
  session.on("close", () => {
    session = null;
  });
  return session;
}

async function pushOne(deviceToken: string): Promise<void> {
  const token = await apnsJwt();
  const s = getSession();

  await new Promise<void>((resolve, reject) => {
    const req = s.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "apns-topic": config.apple.passTypeId, // pass-type bundle for wallet push
      "apns-push-type": "background",
      authorization: `bearer ${token}`,
      "content-type": "application/json",
    });

    // Wallet update push has an empty JSON body.
    req.end("{}");

    let statusCode = 0;
    let body = "";
    req.on("response", (headers) => {
      statusCode = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      if (statusCode >= 200 && statusCode < 300) {
        resolve();
      } else {
        // 410 = device token no longer valid; caller should prune.
        const err = new Error(`APNs ${statusCode}: ${body}`);
        (err as Error & { statusCode?: number }).statusCode = statusCode;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function pushAppleWalletUpdate(customerId: string): Promise<void> {
  if (!appleEnabled) return;

  const { rows } = await query<{
    device_library_id: string;
    push_token: string;
  }>(
    `
    select d.device_library_id, d.push_token
    from apple_devices d
    join passes p
      on p.serial_number = d.serial_number
     and p.platform = 'apple'
    where p.customer_id = $1
    `,
    [customerId],
  );

  for (const row of rows) {
    try {
      await pushOne(row.push_token);
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode;
      if (code === 410) {
        await query(
          `delete from apple_devices
           where device_library_id = $1 and push_token = $2`,
          [row.device_library_id, row.push_token],
        );
      } else {
        console.error("[apns] push failed:", err);
      }
    }
  }
}
