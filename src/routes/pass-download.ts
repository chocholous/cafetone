// GET /pass/:serial.pkpass — Apple pass download link (used by the iOS branch
// of the join page).
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { config, appleEnabled } from "../config.js";
import { buildApplePkpass } from "../lib/apple-pass.js";
import { signPassQr, signGdprToken } from "../lib/jwt.js";

export function registerPassDownload(app: FastifyInstance) {
  app.get<{ Params: { serial: string } }>(
    "/pass/:serial.pkpass",
    async (req, reply) => {
      if (!appleEnabled) return reply.code(404).send();
      const { rows } = await query<{
        customer_id: string;
        auth_token: string;
        stamps_count: number;
        reward_ready: boolean;
      }>(
        `
        select p.customer_id, p.auth_token, c.stamps_count, c.reward_ready
        from passes p
        join customers c on c.id = p.customer_id
        where p.serial_number = $1 and p.platform = 'apple'
        `,
        [req.params.serial],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send();

      const buf = await buildApplePkpass({
        serialNumber: req.params.serial,
        authenticationToken: row.auth_token,
        stampsCount: row.stamps_count,
        stampsRequired: config.bar.stampsRequired,
        rewardReady: row.reward_ready,
        qrMessage: signPassQr(row.customer_id),
        gdprUrl: `${config.publicBaseUrl}/unsubscribe?token=${signGdprToken(row.customer_id)}`,
      });

      reply
        .header("content-type", "application/vnd.apple.pkpass")
        .header("content-disposition", `attachment; filename="${config.bar.shortName}.pkpass"`)
        .send(buf);
    },
  );
}
