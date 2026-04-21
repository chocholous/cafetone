// Customer signup. Creates the customer row + pass rows (serial + auth
// token) then returns links the join page uses to hand over a wallet pass.
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { randomBytes } from "node:crypto";
import { query, tx } from "../db.js";
import { config, appleEnabled, googleEnabled } from "../config.js";
import { buildSaveLink } from "../lib/google-wallet.js";
import { signPassQr } from "../lib/jwt.js";

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function makeToken(): string {
  return randomBytes(24).toString("base64url");
}

export function registerJoin(app: FastifyInstance) {
  app.post<{
    Body: {
      email?: string;
      phone?: string;
      consent?: boolean;
      platform?: "apple" | "google";
    };
  }>("/join", async (req, reply) => {
    const { email, phone, consent, platform } = req.body ?? {};
    if (!consent) {
      return reply.code(400).send({ error: "consent_required" });
    }
    if (!email && !phone) {
      return reply.code(400).send({ error: "contact_required" });
    }
    if (email && !isEmail(email)) {
      return reply.code(400).send({ error: "invalid_email" });
    }
    const plat = platform === "apple" || platform === "google" ? platform : null;
    if (!plat) return reply.code(400).send({ error: "invalid_platform" });
    if (plat === "apple" && !appleEnabled) {
      return reply.code(400).send({ error: "apple_not_configured" });
    }
    if (plat === "google" && !googleEnabled) {
      return reply.code(400).send({ error: "google_not_configured" });
    }

    // Dedupe: if we already have a customer with this email/phone, reuse them
    // and reuse (or overwrite) their pass of the requested platform.
    const found = await query<{ id: string }>(
      `select id from customers
       where (email is not null and email = $1)
          or (phone is not null and phone = $2)
       limit 1`,
      [email ?? null, phone ?? null],
    );

    let customerId: string;
    if (found.rows[0]) {
      customerId = found.rows[0].id;
    } else {
      customerId = ulid();
      await query(
        `insert into customers (id, email, phone, consent_at)
         values ($1, $2, $3, now())`,
        [customerId, email ?? null, phone ?? null],
      );
    }

    const serial = ulid();
    const authToken = makeToken();

    await tx(async (client) => {
      // One pass per platform per customer; delete the old one if re-joining.
      await client.query(
        `delete from passes where customer_id = $1 and platform = $2`,
        [customerId, plat],
      );
      await client.query(
        `insert into passes
           (id, customer_id, platform, serial_number, auth_token)
         values ($1, $2, $3, $4, $5)`,
        [ulid(), customerId, plat, serial, authToken],
      );
    });

    if (plat === "apple") {
      return reply.send({
        platform: "apple",
        downloadUrl: `${config.publicBaseUrl}/pass/${serial}.pkpass`,
      });
    }

    // Google: build a save link on the fly.
    const saveUrl = await buildSaveLink({
      serial,
      stampsCount: 0,
      stampsRequired: config.bar.stampsRequired,
      rewardReady: false,
      qrMessage: signPassQr(customerId),
    });
    return reply.send({ platform: "google", saveUrl });
  });
}
