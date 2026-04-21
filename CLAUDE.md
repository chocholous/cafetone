# Cafetone — Claude Code guide

You are continuing work on a Loyalty Wallet MVP. The codebase was scaffolded
end-to-end by a prior Claude on the web; you're picking up at the "put it in
front of real users" stage. Most of the build is done — your job is to help
the user finish the external-integration work and ship.

## What this is

Single-bar digital loyalty stamp card. Customer scans a QR on the bar, gets
a digital pass in Apple Wallet or Google Wallet, barista stamps on purchase,
reward unlocks at N stamps. No native app. Single tenant. Just this one bar.

Stack: Node 20 · TypeScript · Fastify · Postgres · `passkit-generator` ·
Google Wallet REST · html5-qrcode PWA.

## Working rules

- **Branch**: work on whatever branch the user is on. Don't force-push or
  rewrite history without asking.
- **Test before commit**: `make test` runs the full end-to-end smoke test in
  Docker Postgres. It should stay green. If it breaks, fix before committing.
- **Typecheck before commit**: `npm run typecheck`. Zero errors.
- **Never commit secrets**: `.gitignore` covers `.env`, `secrets/`, `*.p8`,
  `*.pem`, `google-service-account*.json`. Double-check `git status` before
  staging. If you see a cert path in a file you're editing, it's a path, not
  the cert — that's fine.
- **Ask before destructive ops**: dropping DB tables, deleting branches,
  force-pushing, deleting users' cert files. The user owns those calls.

## Scope guardrails — push back if the user drifts

The spec is intentionally small. These are **out of scope** for v1:

- Multi-tenant / multi-location
- Points, tiers, coupons, referrals
- Customer-facing web account
- Push-marketing messages
- Analytics dashboard (read the DB directly)
- Accounting / VAT receipts
- Native apps (for either customer or staff)

If the user asks for any of these, ask whether it's really v1 before building.
Three similar lines is better than a premature abstraction for v2.

**Multi-tenant / subdomain SaaS has its own written plan**:
`docs/phase2-multitenant.md`. If the user asks for "each bar gets a
subdomain" / "self-service registration" / "admin panel across bars", open
that doc and walk them through it. **Do not start building Phase 2 until
the Phase 1 pilot has run and the user has answered the open questions in
section 12** — those unblock the first PR.

## Dev loop

```sh
make install        # once
make test           # full e2e smoke test in Docker — always green
make up             # Postgres + migrations + seed (idempotent)
make dev            # server in foreground, tsx watch mode
make tunnel         # HTTPS URL via cloudflared for phone testing
make down           # stop Postgres, keep data
make nuke           # stop, delete volume, delete .env
```

Dev mode runs with `DEV_MOCK_WALLETS=true`. `/join` returns a link to an
in-browser pass simulator at `/dev/pass/:serial` with a live QR — scan it
from `/pwa/` to drive the full flow without Apple/Google credentials.

Skip-magic-link staff login is at `GET /dev/login?email=…` in dev mode only.

## Project layout

```
src/
  index.ts                   Fastify entrypoint
  config.ts                  env → typed config; exports appleEnabled,
                             googleEnabled, anyWalletAvailable
  db.ts                      pg pool + tx() helper
  lib/
    jwt.ts                   pass QR, staff session, GDPR, magic-link tokens
    apple-pass.ts            .pkpass generation (passkit-generator)
    apple-apns.ts            HTTP/2 APNs push for wallet silent updates
    google-wallet.ts         LoyaltyClass/Object + save-to-wallet JWT
    wallet-sync.ts           fan-out push on every stamp/redeem
    email.ts                 Postmark (or stdout in dev)
    rate-limit.ts            DB-backed per-customer stamp cooldown
  routes/
    join.ts                  POST /join
    pass-download.ts         GET /pass/:serial.pkpass
    passkit-ws.ts            Apple PassKit Web Service (6 spec endpoints)
    staff.ts                 magic-link auth + session cookie
    stamp.ts                 POST /stamp
    redeem.ts                POST /redeem
    unsubscribe.ts           GDPR delete
    dev.ts                   mock wallet simulator (gated on DEV_MOCK_WALLETS)
migrations/001_init.sql      full schema
migrations/002_staff_sessions.sql  per-device staff sessions (many-to-one)
public/
  join/index.html            customer signup page
  pwa/                       barista PWA (html5-qrcode)
scripts/
  migrate.ts                 forward-only migration runner
  seed-dev.ts                seeds staff; DEV_WIPE=true also wipes test data
  smoke.ts                   full e2e HTTP smoke test
  google-bootstrap.ts        one-off create LoyaltyClass in Google Wallet
assets/apple-pass/           PNG icons the user drops in (icon.png etc.)
secrets/                     gitignored; user drops Apple/Google certs here
.env.dev                     ready-to-use dev env (copied to .env by `make up`)
```

## Current state

**Works end-to-end in dev-mock mode.** Verified by `make test` green run.

**Blocked on external approvals**, not code:

- Apple Wallet — needs Apple Developer account ($99/yr) + Pass Type ID +
  signing cert + APNs `.p8`. When those arrive, drop them in `secrets/`, fill
  `.env`, flip `DEV_MOCK_WALLETS=false`. See `docs/setup/apple-wallet.md`.
- Google Wallet — needs Google Wallet issuer approval (1–2 weeks). In the
  meantime you can develop against the test-mode issuer. See
  `docs/setup/google-wallet.md`.
- Deployment — needs a public HTTPS host (wallet passes refuse HTTP). See
  `docs/setup/deploy-fly.md` for the recommended path.

**Not yet built** (intentional; user will ask when needed):

- `/privacy` page (referenced from `/join/`)
- Production analytics queries file
- Cron GDPR purge job (hard-delete after 30 days)
- Print-ready QR poster HTML
- Admin view for today's stamps/redemptions

## Playbooks — read the relevant one, then walk the user through it

- `docs/setup/rollout.md` — 20-step path from current repo to real wallet
  passes in a customer's phone. Start here if the user says "how do we
  actually launch".
- `docs/setup/apple-wallet.md` — certs, APNs key, asset PNGs, testing
- `docs/setup/google-wallet.md` — issuer, service account, bootstrap
- `docs/setup/deploy-fly.md` — Fly.io deploy with managed Postgres
- `docs/setup/launch-checklist.md` — pre-open-day verification list
- `docs/phase2-multitenant.md` — the planned SaaS pivot (subdomains,
  onboarding wizard, billing). Designed to maximize reuse of Phase 1 code.
  Gate: don't start until the pilot has been open ≥ 2 weeks with real stamps.

Each playbook tags steps with **[you]** (user does it, you guide) or **[me]**
(Claude does it). Respect those boundaries — don't sign up for things on the
user's behalf, and don't wait for the user to run typecheck.

## How to respond to common requests

| User says                   | You do                                              |
|-----------------------------|-----------------------------------------------------|
| "set up Apple Wallet"       | Open `docs/setup/apple-wallet.md`, walk step-by-step |
| "set up Google Wallet"      | Open `docs/setup/google-wallet.md`                   |
| "deploy it"                 | Open `docs/setup/deploy-fly.md`                      |
| "test from my phone"        | `make tunnel`, update `PUBLIC_BASE_URL`, restart     |
| "it's broken"               | Run `make test`; inspect `.runtime/server.log`       |
| "add [out-of-scope feature]" | Check scope guardrails, push back if appropriate     |
| "it's launch day"           | Open `docs/setup/launch-checklist.md`                |
| "let's start multi-tenant"  | Open `docs/phase2-multitenant.md`, confirm the open questions in §12 before touching code |

## House style

- Default to no comments; only write one when the WHY is non-obvious.
- Edit existing files over creating new ones.
- Small, targeted commits — one logical change each. Use the existing commit
  tone (imperative mood, no marketing copy).
- When touching the `/stamp` or `/redeem` path, re-run `make test` before
  committing; those are the revenue-critical flows.
