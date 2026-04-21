// POST /stamp — barista scans customer wallet QR, we increment stamps.
// If the customer is already at the reward threshold, return an error so the
// barista hits /redeem instead. The PWA shows the pass state before acting.
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { query, tx } from "../db.js";
import { config } from "../config.js";
import { verifyPassQr } from "../lib/jwt.js";
import { canStamp } from "../lib/rate-limit.js";
import { syncCustomerWallet } from "../lib/wallet-sync.js";
import { requireStaff } from "./staff.js";

export function registerStamp(app: FastifyInstance) {
  app.post<{ Body: { token?: string } }>("/stamp", async (req, reply) => {
    const staffId = await requireStaff(req, reply);
    if (!staffId) return;
    const token = req.body?.token;
    if (!token) return reply.code(400).send({ error: "token_required" });

    let customerId: string;
    try {
      customerId = verifyPassQr(token).sub;
    } catch {
      return reply.code(400).send({ error: "invalid_token" });
    }

    const { rows } = await query<{
      stamps_count: number;
      reward_ready: boolean;
      deleted_at: Date | null;
    }>(
      `select stamps_count, reward_ready, deleted_at from customers where id = $1`,
      [customerId],
    );
    const customer = rows[0];
    if (!customer || customer.deleted_at) {
      return reply.code(404).send({ error: "customer_not_found" });
    }
    if (customer.reward_ready) {
      return reply
        .code(409)
        .send({ error: "reward_ready", hint: "use /redeem" });
    }
    if (!(await canStamp(customerId))) {
      return reply.code(429).send({
        error: "rate_limited",
        cooldownSeconds: config.limits.stampCooldownSeconds,
      });
    }

    const updated = await tx(async (client) => {
      await client.query(
        `insert into stamps (id, customer_id, staff_id, device_ip)
         values ($1, $2, $3, $4::inet)`,
        [ulid(), customerId, staffId, req.ip ?? null],
      );
      const upd = await client.query<{
        stamps_count: number;
        reward_ready: boolean;
      }>(
        `
        update customers
           set stamps_count = stamps_count + 1,
               last_stamp_at = now(),
               reward_ready = (stamps_count + 1) >= $2
         where id = $1
         returning stamps_count, reward_ready
        `,
        [customerId, config.bar.stampsRequired],
      );
      await client.query(
        `update passes set last_updated_at = now() where customer_id = $1`,
        [customerId],
      );
      return upd.rows[0];
    });

    syncCustomerWallet(customerId).catch((err) =>
      console.error("[stamp] wallet sync:", err),
    );

    return reply.send({
      stamps: updated?.stamps_count ?? 0,
      rewardReady: updated?.reward_ready ?? false,
      stampsRequired: config.bar.stampsRequired,
    });
  });
}
