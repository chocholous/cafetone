// Dev-mode routes. Only registered when DEV_MOCK_WALLETS=true. These let you
// test the whole UX without any Apple/Google credentials:
//
//   GET  /dev/pass/:serial        — "fake wallet pass" page that renders a
//                                   live QR (real signed JWT) and polls for
//                                   state updates. Scan this from /pwa/.
//   GET  /dev/pass/:serial.json   — current pass state (stamps, rewardReady,
//                                   fresh qrMessage).
//   GET  /dev/login?email=…       — issues a staff session cookie directly.
//                                   Skips the magic-link round trip.

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";
import { signPassQr, signStaffSession } from "../lib/jwt.js";

function sha256(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

const PAGE = (bar: string, serial: string) => `
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bar} — Mock Pass</title>
<style>
  :root { --bg:#111; --card:#1d1d1d; --fg:#fff; --muted:#aaa; --accent:#e8a87c; --ok:#2ecc71; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 -apple-system, system-ui, sans-serif;
         background: var(--bg); color: var(--fg); min-height: 100vh;
         display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .pass {
    width: 100%; max-width: 20rem; background: #212121; border-radius: 1rem;
    overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,.5);
  }
  .top { padding: 1.25rem 1.25rem .5rem; }
  .brand { font-size: .75rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
  .big { font-size: 3.25rem; font-weight: 700; line-height: 1; margin: .5rem 0 .25rem; }
  .label { color: var(--muted); font-size: .875rem; text-transform: uppercase; letter-spacing: .05em; }
  .reward { color: var(--accent); font-size: 1.75rem; font-weight: 700; }
  .qr { background: #fff; padding: 1rem; display: flex; justify-content: center; }
  .qr svg, .qr canvas, .qr img { width: 100% !important; height: auto !important; display: block; }
  .foot { padding: .75rem 1.25rem 1rem; font-size: .75rem; color: var(--muted); text-align: center; }
  .banner { background: #8b2e2e; padding: .5rem 1rem; font-size: .75rem; text-align: center; letter-spacing: .05em; text-transform: uppercase; }
</style>
<div class="banner">Dev mock — not a real wallet pass</div>
<div class="pass">
  <div class="top">
    <div class="brand" id="brand">${bar}</div>
    <div id="primary">
      <div class="big" id="count">– / –</div>
      <div class="label">Stamps</div>
    </div>
  </div>
  <div class="qr"><div id="qr"></div></div>
  <div class="foot">Serial <code>${serial}</code> · auto-refreshes</div>
</div>

<script src="/vendor/qrcode/qrcode.min.js"></script>
<script>
  const SERIAL = ${JSON.stringify(serial)};
  const qrDiv  = document.getElementById("qr");
  const primary = document.getElementById("primary");
  const count   = document.getElementById("count");

  async function tick() {
    try {
      const res = await fetch("/dev/pass/" + SERIAL + ".json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();

      if (data.rewardReady) {
        primary.innerHTML = '<div class="reward">REWARD READY</div><div class="label">' + data.rewardText + '</div>';
      } else {
        count.textContent = data.stamps + " / " + data.stampsRequired;
      }

      qrDiv.innerHTML = "";
      await QRCode.toCanvas(
        (() => { const c = document.createElement("canvas"); qrDiv.appendChild(c); return c; })(),
        data.qrMessage,
        { width: 280, margin: 1, errorCorrectionLevel: "M" },
      );
    } catch (e) {}
  }

  tick();
  setInterval(tick, 3000);
</script>
</html>`;

export function registerDev(app: FastifyInstance) {
	if (!config.devMockWallets) return;

	// Pass simulator page.
	app.get<{ Params: { serial: string } }>(
		"/dev/pass/:serial",
		async (req, reply) => {
			const { rows } = await query<{ id: string }>(
				`select id from passes where serial_number = $1`,
				[req.params.serial],
			);
			if (!rows[0])
				return reply.code(404).type("text/html").send("<h1>Unknown pass</h1>");
			return reply
				.type("text/html")
				.send(PAGE(config.bar.name, req.params.serial));
		},
	);

	// State + fresh QR JWT for the simulator to render.
	app.get<{ Params: { serial: string } }>(
		"/dev/pass/:serial.json",
		async (req, reply) => {
			const { rows } = await query<{
				customer_id: string;
				stamps_count: number;
				reward_ready: boolean;
			}>(
				`
      select p.customer_id, c.stamps_count, c.reward_ready
      from passes p join customers c on c.id = p.customer_id
      where p.serial_number = $1
      `,
				[req.params.serial],
			);
			const row = rows[0];
			if (!row) return reply.code(404).send({ error: "not_found" });
			return reply.header("cache-control", "no-store").send({
				stamps: row.stamps_count,
				stampsRequired: config.bar.stampsRequired,
				rewardReady: row.reward_ready,
				rewardText: config.bar.rewardText,
				qrMessage: signPassQr(row.customer_id),
			});
		},
	);

	// Skip-magic-link staff login. Creates the staff row if it doesn't exist.
	app.get<{ Querystring: { email?: string } }>(
		"/dev/login",
		async (req, reply) => {
			const email = (req.query.email ?? "").trim().toLowerCase();
			if (!email) return reply.code(400).send({ error: "email_required" });

			const { rows } = await query<{ id: string }>(
				`select id from staff where lower(email) = $1`,
				[email],
			);
			let staffId = rows[0]?.id;
			if (!staffId) {
				const { ulid } = await import("ulid");
				staffId = ulid();
				await query(`insert into staff (id, email) values ($1, $2)`, [
					staffId,
					email,
				]);
			}

			const session = signStaffSession(staffId);
			const exp = new Date(
				Date.now() + config.limits.staffSessionDays * 86_400_000,
			);
			await query(
				`update staff
         set session_hash = $1, session_exp = $2, last_login_at = now()
         where id = $3`,
				[sha256(session), exp, staffId],
			);

			reply
				.setCookie("cafetone_staff", session, {
					httpOnly: true,
					secure: false,
					sameSite: "lax",
					path: "/",
					expires: exp,
				})
				.send({ ok: true, staffId, session });
		},
	);
}
