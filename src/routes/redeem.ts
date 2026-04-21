// POST /redeem — only succeeds when the customer's card is full.
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { query, tx } from "../db.js";
import { config } from "../config.js";
import { verifyPassQr } from "../lib/jwt.js";
import { syncCustomerWallet } from "../lib/wallet-sync.js";
import { requireStaff } from "./staff.js";

export function registerRedeem(app: FastifyInstance) {
  app.post<{ Body: { token?: string } }>("/redeem", async (req, reply) => {
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
    if (!customer.reward_ready) {
      return reply.code(409).send({
        error: "not_ready",
        stamps: customer.stamps_count,
        stampsRequired: config.bar.stampsRequired,
      });
    }

    await tx(async (client) => {
      await client.query(
        `insert into redemptions (id, customer_id, staff_id, stamps_count)
         values ($1, $2, $3, $4)`,
        [ulid(), customerId, staffId, customer.stamps_count],
      );
      await client.query(
        `
        update customers
           set stamps_count = 0,
               reward_ready = false,
               last_stamp_at = now()
         where id = $1
        `,
        [customerId],
      );
      await client.query(
        `update passes set last_updated_at = now() where customer_id = $1`,
        [customerId],
      );
    });

    syncCustomerWallet(customerId).catch((err) =>
      console.error("[redeem] wallet sync:", err),
    );

    return reply.send({
      stamps: 0,
      stampsRequired: config.bar.stampsRequired,
      rewardReady: false,
    });
  });
}
