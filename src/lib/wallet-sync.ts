// Fan-out to whichever wallets the customer installed the pass on.
// Failures don't throw — stamps must commit even if push is flaky. The
// device will pull on next open regardless.
import { query } from "../db.js";
import { pushAppleWalletUpdate } from "./apple-apns.js";
import { upsertLoyaltyObject } from "./google-wallet.js";
import { signPassQr } from "./jwt.js";
import { config, appleEnabled, googleEnabled } from "../config.js";

export async function syncCustomerWallet(customerId: string): Promise<void> {
  const { rows: customers } = await query<{
    stamps_count: number;
    reward_ready: boolean;
  }>(
    `select stamps_count, reward_ready from customers where id = $1`,
    [customerId],
  );
  const customer = customers[0];
  if (!customer) return;

  const { rows: passes } = await query<{
    platform: "apple" | "google";
    serial_number: string;
  }>(`select platform, serial_number from passes where customer_id = $1`, [
    customerId,
  ]);

  const qrMessage = signPassQr(customerId);

  for (const p of passes) {
    if (p.platform === "google" && googleEnabled) {
      try {
        await upsertLoyaltyObject({
          serial: p.serial_number,
          stampsCount: customer.stamps_count,
          stampsRequired: config.bar.stampsRequired,
          rewardReady: customer.reward_ready,
          qrMessage,
        });
      } catch (err) {
        console.error("[wallet-sync] google error:", err);
      }
    }
  }

  if (appleEnabled) {
    try {
      await pushAppleWalletUpdate(customerId);
    } catch (err) {
      console.error("[wallet-sync] apple error:", err);
    }
  }
}
