// Apple Wallet .pkpass generation.
//
// passkit-generator handles the manifest, SHA-1s, and PKCS#7 signing. We
// supply: signing cert + key, WWDR cert, pass.json props, and the PNG assets
// the user drops into assets/apple-pass/ (icon.png, icon@2x.png, logo.png…).
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PKPass } from "passkit-generator";
import { config, appleEnabled } from "../config.js";

interface BuildArgs {
  serialNumber: string;
  authenticationToken: string;
  stampsCount: number;
  stampsRequired: number;
  rewardReady: boolean;
  qrMessage: string;
  gdprUrl: string;
}

interface LoadedCerts {
  wwdr: Buffer;
  signerCert: Buffer;
  signerKey: Buffer;
}

let cachedCerts: LoadedCerts | null = null;
let cachedAssets: Record<string, Buffer> | null = null;

async function loadCerts(): Promise<LoadedCerts> {
  if (cachedCerts) return cachedCerts;
  const [wwdr, signerCert, signerKey] = await Promise.all([
    readFile(config.apple.wwdrCertPath),
    readFile(config.apple.signerCertPath),
    readFile(config.apple.signerKeyPath),
  ]);
  cachedCerts = { wwdr, signerCert, signerKey };
  return cachedCerts;
}

async function loadAssets(): Promise<Record<string, Buffer>> {
  if (cachedAssets) return cachedAssets;
  const dir = join(process.cwd(), "assets", "apple-pass");
  const entries = await readdir(dir).catch(() => [] as string[]);
  const bufs: Record<string, Buffer> = {};
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    bufs[name] = await readFile(join(dir, name));
  }
  // Apple requires at least icon.png (29x29) and icon@2x.png (58x58).
  // Fail loudly at boot if the user forgot.
  if (!bufs["icon.png"] || !bufs["icon@2x.png"]) {
    throw new Error(
      "assets/apple-pass/icon.png and icon@2x.png are required — drop your PNGs there.",
    );
  }
  cachedAssets = bufs;
  return cachedAssets;
}

export async function buildApplePkpass(args: BuildArgs): Promise<Buffer> {
  if (!appleEnabled) throw new Error("Apple Wallet not configured");

  const [certs, assets] = await Promise.all([loadCerts(), loadAssets()]);

  const passProps = {
    formatVersion: 1 as const,
    passTypeIdentifier: config.apple.passTypeId,
    teamIdentifier: config.apple.teamId,
    organizationName: config.apple.orgName,
    serialNumber: args.serialNumber,
    authenticationToken: args.authenticationToken,
    webServiceURL: `${config.publicBaseUrl}/`,
    description: `${config.bar.name} loyalty card`,
    logoText: config.bar.shortName,
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(33,33,33)",
    labelColor: "rgb(255,255,255)",
  };

  const pass = new PKPass(
    assets,
    {
      wwdr: certs.wwdr,
      signerCert: certs.signerCert,
      signerKey: certs.signerKey,
      signerKeyPassphrase: config.apple.signerKeyPassphrase || undefined,
    },
    passProps,
  );

  pass.type = "storeCard";

  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: args.qrMessage,
    messageEncoding: "iso-8859-1",
  });

  if (args.rewardReady) {
    pass.primaryFields.push({
      key: "reward",
      label: "REWARD READY",
      value: config.bar.rewardText,
    });
  } else {
    pass.primaryFields.push({
      key: "stamps",
      label: "Stamps",
      value: `${args.stampsCount} / ${args.stampsRequired}`,
    });
  }

  pass.secondaryFields.push({
    key: "reward_at",
    label: "Reward at",
    value: `${args.stampsRequired} stamps`,
  });

  pass.backFields.push(
    {
      key: "about",
      label: "How it works",
      value: `Show this pass at ${config.bar.name}. After ${args.stampsRequired} stamps, your next ${config.bar.rewardText.toLowerCase()} is on us.`,
    },
    {
      key: "terms",
      label: "Terms",
      value: "One stamp per purchase. Pass is personal, non-transferable.",
    },
    {
      key: "unsubscribe",
      label: "Unsubscribe & delete my data",
      value: args.gdprUrl,
      attributedValue: `<a href="${args.gdprUrl}">Tap to delete your loyalty account</a>`,
    },
  );

  return pass.getAsBuffer();
}
