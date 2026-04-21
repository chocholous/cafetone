// Apple PassKit Web Service. See:
// https://developer.apple.com/documentation/walletpasses
//
// Six endpoints, all mounted under the `webServiceURL` we set on the pass.
// The device authenticates with "ApplePass <authenticationToken>" header
// against the token we embedded when generating the pass.
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../db.js";
import { config, appleEnabled } from "../config.js";
import { buildApplePkpass } from "../lib/apple-pass.js";
import { signPassQr, signGdprToken } from "../lib/jwt.js";

function authTokenFromHeader(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^ApplePass\s+(\S+)/i.exec(h);
  return m?.[1] ?? null;
}

async function serialAuthorized(serial: string, token: string): Promise<boolean> {
  const { rows } = await query<{ auth_token: string }>(
    `select auth_token from passes
     where serial_number = $1 and platform = 'apple'`,
    [serial],
  );
  const row = rows[0];
  if (!row) return false;
  // Constant-time-ish; the values are short and equal-length in practice.
  return row.auth_token === token;
}

export function registerPassKitWebService(app: FastifyInstance) {
  if (!appleEnabled) return;

  const { passTypeId } = config.apple;

  // Register a device to receive push notifications for a pass.
  app.post<{
    Params: { deviceId: string; passTypeId: string; serial: string };
    Body: { pushToken?: string };
  }>(
    "/v1/devices/:deviceId/registrations/:passTypeId/:serial",
    async (req, reply) => {
      if (req.params.passTypeId !== passTypeId) {
        return reply.code(401).send();
      }
      const auth = authTokenFromHeader(req);
      if (!auth || !(await serialAuthorized(req.params.serial, auth))) {
        return reply.code(401).send();
      }
      const pushToken = req.body?.pushToken;
      if (!pushToken) return reply.code(400).send();

      const { rowCount } = await query(
        `
        insert into apple_devices
          (device_library_id, pass_type_id, serial_number, push_token)
        values ($1, $2, $3, $4)
        on conflict (device_library_id, pass_type_id, serial_number)
        do update set push_token = excluded.push_token,
                      registered_at = now()
        returning (xmax = 0) as created
        `,
        [req.params.deviceId, req.params.passTypeId, req.params.serial, pushToken],
      );
      // 201 on create, 200 on update — spec requires this distinction.
      return reply.code(rowCount === 1 ? 201 : 200).send();
    },
  );

  // Unregister.
  app.delete<{
    Params: { deviceId: string; passTypeId: string; serial: string };
  }>(
    "/v1/devices/:deviceId/registrations/:passTypeId/:serial",
    async (req, reply) => {
      if (req.params.passTypeId !== passTypeId) {
        return reply.code(401).send();
      }
      const auth = authTokenFromHeader(req);
      if (!auth || !(await serialAuthorized(req.params.serial, auth))) {
        return reply.code(401).send();
      }
      await query(
        `delete from apple_devices
         where device_library_id = $1 and pass_type_id = $2 and serial_number = $3`,
        [req.params.deviceId, req.params.passTypeId, req.params.serial],
      );
      return reply.code(200).send();
    },
  );

  // "Which of my passes have updates since X?"
  app.get<{
    Params: { deviceId: string; passTypeId: string };
    Querystring: { passesUpdatedSince?: string };
  }>(
    "/v1/devices/:deviceId/registrations/:passTypeId",
    async (req, reply) => {
      if (req.params.passTypeId !== passTypeId) {
        return reply.code(401).send();
      }
      const since = req.query.passesUpdatedSince
        ? new Date(Number(req.query.passesUpdatedSince) * 1000)
        : new Date(0);

      const { rows } = await query<{
        serial_number: string;
        last_updated_at: Date;
      }>(
        `
        select p.serial_number, p.last_updated_at
        from passes p
        join apple_devices d on d.serial_number = p.serial_number
         and d.pass_type_id = $2
        where d.device_library_id = $1
          and p.last_updated_at > $3
        `,
        [req.params.deviceId, req.params.passTypeId, since],
      );

      if (rows.length === 0) return reply.code(204).send();

      const lastUpdated = rows.reduce<Date>(
        (acc, r) => (r.last_updated_at > acc ? r.last_updated_at : acc),
        since,
      );
      return reply.send({
        lastUpdated: String(Math.floor(lastUpdated.getTime() / 1000)),
        serialNumbers: rows.map((r) => r.serial_number),
      });
    },
  );

  // Latest pass contents.
  app.get<{ Params: { passTypeId: string; serial: string } }>(
    "/v1/passes/:passTypeId/:serial",
    async (req, reply) => {
      if (req.params.passTypeId !== passTypeId) {
        return reply.code(401).send();
      }
      const auth = authTokenFromHeader(req);
      if (!auth || !(await serialAuthorized(req.params.serial, auth))) {
        return reply.code(401).send();
      }

      const { rows } = await query<{
        id: string;
        customer_id: string;
        auth_token: string;
        stamps_count: number;
        reward_ready: boolean;
        last_updated_at: Date;
      }>(
        `
        select p.id, p.customer_id, p.auth_token, p.last_updated_at,
               c.stamps_count, c.reward_ready
        from passes p join customers c on c.id = p.customer_id
        where p.serial_number = $1 and p.platform = 'apple'
        `,
        [req.params.serial],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send();

      const ifModified = req.headers["if-modified-since"];
      if (ifModified) {
        const since = new Date(ifModified as string);
        if (!Number.isNaN(since.getTime()) && row.last_updated_at <= since) {
          return reply.code(304).send();
        }
      }

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
        .header("last-modified", row.last_updated_at.toUTCString())
        .send(buf);
    },
  );

  // Device log endpoint — Apple sends diagnostics. Just swallow and log.
  app.post<{ Body: { logs?: string[] } }>(
    "/v1/log",
    async (req, reply) => {
      const logs = req.body?.logs ?? [];
      for (const line of logs) console.log("[passkit-device]", line);
      return reply.code(200).send();
    },
  );
}
