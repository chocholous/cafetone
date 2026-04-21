import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`env ${name} is required`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`env ${name} must be integer`);
  return n;
}

function bool(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}

export const config = {
  env: optional("NODE_ENV", "development"),
  port: int("PORT", 3000),
  publicBaseUrl: required("PUBLIC_BASE_URL").replace(/\/$/, ""),

  databaseUrl: required("DATABASE_URL"),

  appJwtSecret: required("APP_JWT_SECRET"),

  bar: {
    name: optional("BAR_NAME", "Cafetone"),
    shortName: optional("BAR_SHORT_NAME", "Cafetone"),
    stampsRequired: int("STAMPS_REQUIRED", 10),
    rewardText: optional("REWARD_TEXT", "Free drink of your choice"),
  },

  apple: {
    passTypeId: optional("APPLE_PASS_TYPE_ID"),
    teamId: optional("APPLE_TEAM_ID"),
    orgName: optional("APPLE_ORG_NAME", "Cafetone"),
    signerCertPath: optional("APPLE_SIGNER_CERT_PATH"),
    signerKeyPath: optional("APPLE_SIGNER_KEY_PATH"),
    signerKeyPassphrase: optional("APPLE_SIGNER_KEY_PASSPHRASE"),
    wwdrCertPath: optional("APPLE_WWDR_CERT_PATH"),
    apnsKeyPath: optional("APPLE_APNS_KEY_PATH"),
    apnsKeyId: optional("APPLE_APNS_KEY_ID"),
    apnsTeamId: optional("APPLE_APNS_TEAM_ID"),
  },

  google: {
    issuerId: optional("GOOGLE_ISSUER_ID"),
    classIdSuffix: optional("GOOGLE_CLASS_ID_SUFFIX", "cafetone_stamp_card_v1"),
    serviceAccountPath: optional("GOOGLE_SERVICE_ACCOUNT_PATH"),
  },

  email: {
    postmarkToken: optional("POSTMARK_TOKEN"),
    from: optional("EMAIL_FROM", "loyalty@example.com"),
  },

  devMockWallets: bool("DEV_MOCK_WALLETS"),

  limits: {
    stampCooldownSeconds: int("STAMP_COOLDOWN_SECONDS", 300),
    passQrJwtTtlSeconds: int("PASS_QR_JWT_TTL_SECONDS", 300),
    staffSessionDays: int("STAFF_SESSION_DAYS", 30),
  },
} as const;

export const appleEnabled =
  !!config.apple.passTypeId && !!config.apple.signerCertPath;
export const googleEnabled =
  !!config.google.issuerId && !!config.google.serviceAccountPath;

// In dev-mock mode /join accepts both platforms and hands back a link to the
// in-browser pass simulator — no Apple/Google credentials required.
export const anyWalletAvailable =
  appleEnabled || googleEnabled || config.devMockWallets;
