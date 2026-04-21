// Google Wallet — Loyalty class/object + Save-to-Wallet link.
//
// Flow:
//   1. A single LoyaltyClass exists for the bar (bootstrap script).
//   2. Each customer gets a LoyaltyObject scoped under that class.
//   3. Handing the customer a "Save to Google Wallet" link = signing a JWT
//      whose payload embeds the object.
//   4. On stamp/redeem we PATCH the object (loyaltyPoints.balance + points
//      label + localized texts). Google pushes the update to the device.
//
// Docs: https://developers.google.com/wallet/retail/loyalty-cards
import { readFile } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { GoogleAuth } from "google-auth-library";
import { config, googleEnabled } from "../config.js";

const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedServiceAccount: ServiceAccount | null = null;
let cachedAuth: GoogleAuth | null = null;

async function serviceAccount(): Promise<ServiceAccount> {
  if (cachedServiceAccount) return cachedServiceAccount;
  const json = await readFile(config.google.serviceAccountPath, "utf8");
  cachedServiceAccount = JSON.parse(json) as ServiceAccount;
  return cachedServiceAccount;
}

function authClient(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new GoogleAuth({
    keyFile: config.google.serviceAccountPath,
    scopes: [WALLET_SCOPE],
  });
  return cachedAuth;
}

function classId(): string {
  return `${config.google.issuerId}.${config.google.classIdSuffix}`;
}

function objectId(serial: string): string {
  return `${config.google.issuerId}.${serial}`;
}

async function apiFetch(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<Response> {
  const client = await authClient().getClient();
  const token = await client.getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token.token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// Build the LoyaltyClass body. The "pending" review state is fine for testing
// with the Wallet API test accounts; production issuers must be approved.
function classBody() {
  return {
    id: classId(),
    issuerName: config.bar.name,
    programName: `${config.bar.name} Loyalty`,
    programLogo: {
      sourceUri: { uri: `${config.publicBaseUrl}/public/join/logo.png` },
    },
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: "#212121",
    countryCode: "US",
    localizedIssuerName: {
      defaultValue: { language: "en", value: config.bar.name },
    },
    localizedProgramName: {
      defaultValue: { language: "en", value: `${config.bar.name} Loyalty` },
    },
  };
}

export async function ensureLoyaltyClass(): Promise<void> {
  if (!googleEnabled) throw new Error("Google Wallet not configured");
  const getRes = await apiFetch("GET", `/loyaltyClass/${classId()}`);
  if (getRes.ok) return;
  if (getRes.status === 404) {
    const createRes = await apiFetch("POST", `/loyaltyClass`, classBody());
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`create class failed: ${createRes.status} ${text}`);
    }
    return;
  }
  const text = await getRes.text();
  throw new Error(`get class failed: ${getRes.status} ${text}`);
}

interface ObjectArgs {
  serial: string;
  stampsCount: number;
  stampsRequired: number;
  rewardReady: boolean;
  qrMessage: string;
}

function objectBody(args: ObjectArgs) {
  const points = args.rewardReady
    ? {
        balance: { string: "REWARD READY" },
        label: config.bar.rewardText,
      }
    : {
        balance: { int: args.stampsCount },
        label: `Stamps (of ${args.stampsRequired})`,
      };

  return {
    id: objectId(args.serial),
    classId: classId(),
    state: "ACTIVE",
    loyaltyPoints: points,
    accountId: args.serial,
    accountName: config.bar.name,
    barcode: {
      type: "QR_CODE",
      value: args.qrMessage,
    },
  };
}

export async function upsertLoyaltyObject(args: ObjectArgs): Promise<void> {
  if (!googleEnabled) throw new Error("Google Wallet not configured");
  const getRes = await apiFetch("GET", `/loyaltyObject/${objectId(args.serial)}`);
  if (getRes.status === 404) {
    const createRes = await apiFetch("POST", `/loyaltyObject`, objectBody(args));
    if (!createRes.ok) {
      throw new Error(`create object failed: ${createRes.status} ${await createRes.text()}`);
    }
    return;
  }
  if (!getRes.ok) {
    throw new Error(`get object failed: ${getRes.status} ${await getRes.text()}`);
  }
  const patchRes = await apiFetch(
    "PATCH",
    `/loyaltyObject/${objectId(args.serial)}`,
    objectBody(args),
  );
  if (!patchRes.ok) {
    throw new Error(`patch object failed: ${patchRes.status} ${await patchRes.text()}`);
  }
}

// Save-to-Google-Wallet: a JWT the customer's browser hands to Google, which
// then pulls the referenced object(s). We can embed the full object so the
// class can be referenced by id only.
export async function buildSaveLink(args: ObjectArgs): Promise<string> {
  if (!googleEnabled) throw new Error("Google Wallet not configured");
  const sa = await serviceAccount();
  const payload = {
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [config.publicBaseUrl.replace(/^https?:\/\//, "")],
    payload: {
      loyaltyObjects: [objectBody(args)],
    },
  };
  const token = jwt.sign(payload, sa.private_key, { algorithm: "RS256" });
  return `https://pay.google.com/gp/v/save/${token}`;
}
