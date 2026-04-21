// GDPR delete. The link on the back of every pass points here. Clicking it
// purges the customer and all referenced rows. Within 30 days Apple/Google
// also drop the pass from the wallet once our web service stops returning it.
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { verifyGdprToken } from "../lib/jwt.js";

const PAGE = (body: string) => `
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #222; }
  button { padding: .75rem 1.5rem; font-size: 1rem; border: 0; border-radius: .5rem; background: #c0392b; color: #fff; cursor: pointer; }
  button:disabled { background: #999; }
  .ok { color: #27ae60; }
</style>
${body}
</html>`;

export function registerUnsubscribe(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>(
    "/unsubscribe",
    async (req, reply) => {
      const token = req.query.token;
      if (!token) {
        return reply
          .type("text/html")
          .send(PAGE("<h1>Invalid link</h1>"));
      }
      try {
        verifyGdprToken(token);
      } catch {
        return reply
          .type("text/html")
          .send(PAGE("<h1>Invalid or expired link</h1>"));
      }
      return reply.type("text/html").send(
        PAGE(`
          <h1>Delete your loyalty account?</h1>
          <p>This will erase your email, phone, stamps, and redemption history. Your wallet pass will stop working.</p>
          <form method="POST" action="/unsubscribe">
            <input type="hidden" name="token" value="${encodeURIComponent(token)}">
            <button type="submit">Delete my data</button>
          </form>
        `),
      );
    },
  );

  app.post<{ Body: { token?: string } }>("/unsubscribe", async (req, reply) => {
    const token = (req.body as { token?: string } | undefined)?.token;
    if (!token) return reply.code(400).type("text/html").send(PAGE("<h1>Invalid</h1>"));
    let customerId: string;
    try {
      customerId = verifyGdprToken(token).sub;
    } catch {
      return reply
        .code(400)
        .type("text/html")
        .send(PAGE("<h1>Invalid or expired link</h1>"));
    }
    // Hard delete: cascades remove passes, stamps, redemptions, device rows.
    await query(`delete from customers where id = $1`, [customerId]);
    return reply.type("text/html").send(
      PAGE(`
        <h1 class="ok">Done.</h1>
        <p>Your data has been deleted. You can remove the pass from your wallet.</p>
      `),
    );
  });
}
