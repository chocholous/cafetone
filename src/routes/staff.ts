// Staff auth: passwordless magic link → session cookie.
// Sessions are per-device; one barista can stay signed in on many devices.

import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ulid } from "ulid";
import { config } from "../config.js";
import { query } from "../db.js";
import { sendEmail } from "../lib/email.js";
import {
	signMagicLink,
	signStaffSession,
	verifyMagicLink,
	verifyStaffSession,
} from "../lib/jwt.js";

const COOKIE = "cafetone_staff";

function sha256(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

export async function requireStaff(
	req: FastifyRequest,
	reply: FastifyReply,
): Promise<string | null> {
	const token = req.cookies?.[COOKIE];
	if (!token) {
		reply.code(401).send({ error: "unauthenticated" });
		return null;
	}
	try {
		const payload = verifyStaffSession(token);
		const { rowCount } = await query(
			`update staff_sessions
         set last_used_at = now()
       where staff_id = $1
         and session_hash = $2
         and expires_at > now()`,
			[payload.sub, sha256(token)],
		);
		if (rowCount === 0) {
			reply.code(401).send({ error: "unauthenticated" });
			return null;
		}
		return payload.sub;
	} catch {
		reply.code(401).send({ error: "invalid_session" });
		return null;
	}
}

export function registerStaff(app: FastifyInstance) {
	// Request a magic link. Always 204s regardless of whether the email is
	// registered, to avoid leaking staff list.
	app.post<{ Body: { email?: string } }>("/staff/login", async (req, reply) => {
		const email = (req.body?.email ?? "").trim().toLowerCase();
		if (!email) return reply.code(400).send({ error: "email_required" });

		const { rows } = await query<{ id: string }>(
			`select id from staff where lower(email) = $1`,
			[email],
		);
		const staffId = rows[0]?.id;
		if (staffId) {
			const token = signMagicLink(staffId);
			await query(
				`update staff set magic_link_hash = $1, magic_link_exp = now() + interval '15 minutes' where id = $2`,
				[sha256(token), staffId],
			);
			const url = `${config.publicBaseUrl}/staff/magic?token=${encodeURIComponent(token)}`;
			await sendEmail({
				to: email,
				subject: `Your ${config.bar.name} barista login`,
				text: `Tap to sign in (valid 15 min):\n\n${url}\n\nIf you didn't request this, ignore.`,
			});
		}
		return reply.code(204).send();
	});

	// Magic link landing — exchanges token for session cookie, then bounces to
	// the PWA.
	app.get<{ Querystring: { token?: string } }>(
		"/staff/magic",
		async (req, reply) => {
			const token = req.query.token;
			if (!token) return reply.code(400).send("missing token");
			let staffId: string;
			try {
				staffId = verifyMagicLink(token);
			} catch {
				return reply.code(400).send("invalid or expired link");
			}
			const { rows } = await query<{
				magic_link_hash: string | null;
				magic_link_exp: Date | null;
			}>(`select magic_link_hash, magic_link_exp from staff where id = $1`, [
				staffId,
			]);
			const row = rows[0];
			if (
				!row ||
				!row.magic_link_hash ||
				row.magic_link_hash !== sha256(token) ||
				!row.magic_link_exp ||
				row.magic_link_exp.getTime() < Date.now()
			) {
				return reply.code(400).send("link already used or expired");
			}

			const session = signStaffSession(staffId);
			const exp = new Date(
				Date.now() + config.limits.staffSessionDays * 86_400_000,
			);
			await query(
				`update staff
         set magic_link_hash = null, magic_link_exp = null,
             last_login_at = now()
         where id = $1`,
				[staffId],
			);
			await query(
				`insert into staff_sessions (id, staff_id, session_hash, expires_at)
         values ($1, $2, $3, $4)`,
				[ulid(), staffId, sha256(session), exp],
			);

			reply
				.setCookie(COOKIE, session, {
					httpOnly: true,
					secure: config.env === "production",
					sameSite: "lax",
					path: "/",
					expires: exp,
				})
				.redirect(`${config.publicBaseUrl}/pwa/`);
		},
	);

	app.post("/staff/logout", async (req, reply) => {
		const token = req.cookies?.[COOKIE];
		const staffId = await requireStaff(req, reply);
		if (!staffId) return;
		if (token) {
			await query(
				`delete from staff_sessions where staff_id = $1 and session_hash = $2`,
				[staffId, sha256(token)],
			);
		}
		reply.clearCookie(COOKIE, { path: "/" }).code(204).send();
	});

	app.get("/staff/me", async (req, reply) => {
		const staffId = await requireStaff(req, reply);
		if (!staffId) return;
		const { rows } = await query<{ email: string }>(
			`select email from staff where id = $1`,
			[staffId],
		);
		return reply.send({ id: staffId, email: rows[0]?.email ?? null });
	});
}
