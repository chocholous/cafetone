# Launch-day checklist

Run through this the day before opening. Every item here has bitten a real
MVP launch somewhere. Don't skip.

**[you]** = user must do it. **[me]** = Claude does / verifies.

---

## Code & config

- [ ] **[me]** `make test` green on `main` / production branch.
- [ ] **[me]** `npm run typecheck` clean.
- [ ] **[me]** `grep -rn TODO src/` — no forgotten blockers.
- [ ] **[me]** `.env` / Fly secrets have `DEV_MOCK_WALLETS=false`.
- [ ] **[me]** `APP_JWT_SECRET` is not the dev default. Regenerate:
      `openssl rand -base64 48`.
- [ ] **[me]** `STAMP_COOLDOWN_SECONDS` ≥ 60 in prod (default 300). Stops
      accidental double-stamps.
- [ ] **[me]** `PUBLIC_BASE_URL` matches the domain pointed to by DNS.

## Wallet integrations

- [ ] **[you]** Fresh Apple install from `/join/` on iPhone works
      end-to-end: add to wallet → scan → stamp shows in ≤ 5 s.
- [ ] **[you]** Fresh Google install on Android works end-to-end.
- [ ] **[me]** `SELECT count(*) FROM apple_devices` > 0 after test install.
      Proves the PassKit Web Service is reachable from Apple.
- [ ] **[you]** Back-side of installed Apple pass shows the
      "Unsubscribe & delete my data" link. Tap → see the red button → don't
      actually submit (it wipes your test account).

## Staff

- [ ] **[me]** Real barista email(s) inserted into `staff` table.
- [ ] **[you]** Each barista has logged in on their phone via magic link at
      least once. Have them tap **Add to Home Screen** in Safari/Chrome so
      it's a one-tap launcher.
- [ ] **[you]** Baristas know: scan QR → "Stamped" toast → if "Reward ready"
      appears, tap **Redeem** to confirm.
- [ ] **[you]** A manager email is also seeded, as a break-glass.

## Legal / GDPR

- [ ] **[you]** `/privacy` page live and linked from `/join/`'s consent
      checkbox. If it's not built, ask Claude to stub one.
- [ ] **[me]** Test `GET /unsubscribe?token=<signGdprToken(testCustomerId)>`
      returns the delete page.
- [ ] **[me]** Verify: delete a test customer, then
      `SELECT count(*) FROM stamps WHERE customer_id = <that id>` = 0
      (cascade works).
- [ ] **[you]** Record where customer data is stored (Fly Postgres, region)
      in your privacy notice.

## Operations

- [ ] **[you]** DB backups enabled (or a daily `pg_dump` cron).
- [ ] **[me]** `fly logs` or equivalent is tailable; you know how to read it.
- [ ] **[me]** Send a test magic-link email end-to-end — Postmark token real,
      deliveries landing, not in spam.
- [ ] **[you]** Your phone number / an on-call plan for day-one issues.

## Physical

- [ ] **[you]** Printed QR poster at the bar, pointing to
      `<PUBLIC_BASE_URL>/join/`. Big enough to scan from ~1 m with a phone.
      Ask Claude for a print-ready HTML if you don't have one.
- [ ] **[you]** Staff know which QR on the poster is for customers
      (`/join/`) vs which is for them (`/pwa/` — ideally not on the poster
      at all; bookmarked on their phone only).

## After launch — week 1

- [ ] **[you]** Check daily:
      `select date_trunc('day', created_at), count(*) from stamps
       group by 1 order by 1 desc limit 7;`
- [ ] **[you]** Watch for surprises:
      `select count(*) from customers where created_at > now() - interval '1 day';`
- [ ] **[me]** If signups feel low, diagnose: Apple vs Google split in the
      `passes` table, join-page errors in server logs.

## Known non-features (don't get asked for these on day one)

These are **not** in the MVP — point the user at the spec if asked:

- Accounting exports / VAT receipts
- Marketing push notifications
- Customer web account / "my stamps" page
- Multi-location / multi-tenant
- Analytics dashboard (read the DB directly)
- Referral codes

If a barista begs for one of these, write it down and revisit in v2.
