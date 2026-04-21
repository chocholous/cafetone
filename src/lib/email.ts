import { config } from "../config.js";

interface SendOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// In dev (no Postmark token) we dump to stdout so magic links are easy to
// grab. In prod, fail loudly if the provider isn't configured.
export async function sendEmail(opts: SendOpts): Promise<void> {
  if (!config.email.postmarkToken) {
    if (config.env === "production") {
      throw new Error("POSTMARK_TOKEN required in production");
    }
    console.log("──── email (dev) ────");
    console.log(`to:      ${opts.to}`);
    console.log(`subject: ${opts.subject}`);
    console.log(opts.text);
    console.log("─────────────────────");
    return;
  }

  const { ServerClient } = await import("postmark");
  const client = new ServerClient(config.email.postmarkToken);
  await client.sendEmail({
    From: config.email.from,
    To: opts.to,
    Subject: opts.subject,
    TextBody: opts.text,
    HtmlBody: opts.html,
    MessageStream: "outbound",
  });
}
