# Cafetone — Loyalty Wallet MVP

Single-bar digital stamp card. QR on the bar → customer gets a wallet pass →
barista stamps on purchase → reward unlocks at N stamps. Apple Wallet + Google
Wallet, no native app.

## Stack

- **Backend:** Node 20, TypeScript, Fastify, Postgres (`pg`)
- **Apple Wallet:** `passkit-generator` + APNs HTTP/2 push
- **Google Wallet:** `googleapis` Wallet Objects API + Save-to-Wallet JWT
- **Barista PWA:** static HTML + `html5-qrcode` + magic-link auth
- **Email:** Postmark (or stdout in dev)

## Layout

```
src/
  index.ts               entry point, wires Fastify
  config.ts              env → typed config
  db.ts                  Postgres pool + helpers
  types.ts
  lib/
    jwt.ts               sign/verify pass QR tokens, staff sessions
    apple-pass.ts        .pkpass generation
    apple-apns.ts        HTTP/2 APNs push (wallet silent update)
    google-wallet.ts     class + object + save-link
    email.ts             Postmark or console
    rate-limit.ts        per-customer stamp cooldown
  routes/
    join.ts              public signup
    pass-download.ts     .pkpass + Google save link
    passkit-ws.ts        Apple PassKit Web Service (6 spec endpoints)
    stamp.ts             barista stamp
    redeem.ts            barista redeem
    staff.ts             magic-link auth
    unsubscribe.ts       GDPR delete
    qr.ts                fresh pass QR JWT (served to wallet pass)
migrations/
  001_init.sql
public/
  join/index.html        customer signup page
  pwa/                   barista PWA
scripts/
  migrate.ts             minimal migration runner
```

## Setup

### 1. Prerequisites

- Apple Developer account → **Pass Type ID** + signing cert + WWDR cert +
  APNs auth key (`.p8`)
- Google Cloud project with **Wallet API** enabled + Issuer ID (approved) +
  service-account JSON
- Postgres 14+
- Domain with HTTPS (wallet pass web service **must** be HTTPS)
- Transactional email provider (Postmark recommended)

### 2. Install + configure

```sh
cp .env.example .env
# fill in .env — see comments in that file

mkdir -p secrets
# drop these in:
#   secrets/pass-cert.pem       (Apple Pass Type signing cert, PEM)
#   secrets/pass-key.pem        (its private key, PEM — keep passphrase in env)
#   secrets/apple-wwdr.pem      (Apple WWDR intermediate cert, PEM)
#   secrets/apns-authkey.p8     (APNs auth key)
#   secrets/google-service-account.json

npm install
npm run migrate
npm run dev
```

### 3. Bootstrap staff

Insert one staff row so you can log in:

```sql
insert into staff (email) values ('you@bar.com');
```

Then visit `/pwa/` on your phone, enter that email, click the magic link.

### 4. Bootstrap Google Wallet class

Classes must exist before objects. One-off:

```sh
tsx scripts/google-bootstrap.ts
```

## Request flow (stamp)

```
Wallet pass (QR) ──► Barista PWA ──► POST /stamp { token }
                                          │
                                          ├─ verify JWT
                                          ├─ check cooldown
                                          ├─ INSERT stamps row
                                          ├─ if count == N → mark "reward ready"
                                          ├─ push Apple (APNs) + Google (PATCH)
                                          └─ respond { stamps, rewardReady }
```

## Security notes

- **Pass QR JWT**: 5-min TTL, signed with `APP_JWT_SECRET`, payload is
  `{ sub: customerId, typ: "stamp" | "redeem" }`. Screenshot replay fails
  once the token expires.
- **Staff session**: httpOnly+secure+sameSite=Lax cookie, 30-day TTL.
- **Rate limit**: hard DB check for `now() - last_stamp_at >= cooldown`
  (see `src/lib/rate-limit.ts`), **not** just a memory cache — survives
  multi-instance deploys.
- **APNs auth**: JWT with ES256 from the `.p8` auth key, rotated in-process
  every 50 min (Apple requires ≤ 60 min).

## GDPR

The backside of every pass has an "Unsubscribe & delete" link pointing at
`/unsubscribe?token=…`. That token is a separate long-lived JWT with
`typ: "gdpr"`. Clicking it purges customer, passes, stamps, and redemption
rows immediately, and invalidates all wallet passes.

## Out of scope

Per spec: multi-tenant, multi-location, tiers, points, coupons, customer web
account, push marketing, referrals, analytics dashboard. Ship first, add
never.
