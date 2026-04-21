import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type {
	GdprPayload,
	PassQrPayload,
	StaffSessionPayload,
} from "../types.js";

const secret = config.appJwtSecret;

// Pass QR — short-lived, signed token the wallet pass embeds in its barcode.
export function signPassQr(customerId: string): string {
	return jwt.sign({ sub: customerId, typ: "stamp" }, secret, {
		expiresIn: config.limits.passQrJwtTtlSeconds,
	});
}

export function verifyPassQr(token: string): PassQrPayload {
	const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
	if (decoded.typ !== "stamp" || typeof decoded.sub !== "string") {
		throw new Error("invalid pass token");
	}
	return decoded as PassQrPayload;
}

// Staff session cookie. `jti` is a random nonce so two logins in the same
// second (or with the same iat-truncation) produce distinct tokens —
// otherwise multi-device sessions would collide on the session_hash index.
export function signStaffSession(staffId: string): string {
	return jwt.sign(
		{ sub: staffId, jti: randomBytes(16).toString("hex") },
		secret,
		{ expiresIn: `${config.limits.staffSessionDays}d` },
	);
}

export function verifyStaffSession(token: string): StaffSessionPayload {
	const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
	if (typeof decoded.sub !== "string") throw new Error("invalid session");
	return decoded as StaffSessionPayload;
}

// GDPR delete — long-lived (effectively perpetual until customer clicks).
export function signGdprToken(customerId: string): string {
	return jwt.sign({ sub: customerId, typ: "gdpr" }, secret);
}

export function verifyGdprToken(token: string): GdprPayload {
	const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
	if (decoded.typ !== "gdpr" || typeof decoded.sub !== "string") {
		throw new Error("invalid gdpr token");
	}
	return decoded as GdprPayload;
}

// Staff magic-link — 15 min.
export function signMagicLink(staffId: string): string {
	return jwt.sign({ sub: staffId, typ: "magic" }, secret, {
		expiresIn: "15m",
	});
}

export function verifyMagicLink(token: string): string {
	const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
	if (decoded.typ !== "magic" || typeof decoded.sub !== "string") {
		throw new Error("invalid magic link");
	}
	return decoded.sub;
}
