import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerDev } from "./routes/dev.js";
import { registerJoin } from "./routes/join.js";
import { registerPassDownload } from "./routes/pass-download.js";
import { registerPassKitWebService } from "./routes/passkit-ws.js";
import { registerRedeem } from "./routes/redeem.js";
import { registerStaff } from "./routes/staff.js";
import { registerStamp } from "./routes/stamp.js";
import { registerUnsubscribe } from "./routes/unsubscribe.js";

async function main() {
	const app = Fastify({
		logger: { level: config.env === "production" ? "info" : "debug" },
		trustProxy: true,
		bodyLimit: 1_048_576,
	});

	// Cookies for the staff session. Signing isn't required because we already
	// verify the JWT inside the cookie value.
	await app.register(cookie);

	// Form-urlencoded body parser for the GDPR unsubscribe submit.
	app.addContentTypeParser(
		"application/x-www-form-urlencoded",
		{ parseAs: "string" },
		(_req, body, done) => {
			try {
				const parsed: Record<string, string> = {};
				new URLSearchParams(body as string).forEach((v, k) => {
					parsed[k] = v;
				});
				done(null, parsed);
			} catch (err) {
				done(err as Error, undefined);
			}
		},
	);

	// Static assets: customer /join page and barista /pwa.
	const here = dirname(fileURLToPath(import.meta.url));
	const publicDir = join(here, "..", "public");
	await app.register(staticPlugin, {
		root: publicDir,
		prefix: "/public/",
		decorateReply: false,
	});
	await app.register(staticPlugin, {
		root: join(publicDir, "join"),
		prefix: "/join/",
		decorateReply: false,
	});
	await app.register(staticPlugin, {
		root: join(publicDir, "pwa"),
		prefix: "/pwa/",
		decorateReply: false,
	});
	await app.register(staticPlugin, {
		root: join(here, "..", "node_modules", "qrcode", "build"),
		prefix: "/vendor/qrcode/",
		decorateReply: false,
	});

	// Root: redirect to join page for the QR on the bar.
	app.get("/", (_req, reply) => reply.redirect("/join/"));

	// Health.
	app.get("/healthz", async () => ({ ok: true }));

	// Bar config for the /join page to render (e.g. stamps threshold).
	app.get("/config", async () => ({
		barName: config.bar.name,
		stampsRequired: config.bar.stampsRequired,
		rewardText: config.bar.rewardText,
	}));

	registerJoin(app);
	registerPassDownload(app);
	registerPassKitWebService(app);
	registerStaff(app);
	registerStamp(app);
	registerRedeem(app);
	registerUnsubscribe(app);
	registerDev(app);

	await app.listen({ host: "0.0.0.0", port: config.port });
	console.log(`cafetone listening on :${config.port}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
