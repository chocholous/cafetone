# Phase 2 — Multi-tenant SaaS pivot

This document is the plan for turning the single-bar MVP into a self-service
SaaS where each bar gets a subdomain, onboards themselves in ~3 minutes,
and operates from an admin panel.

**Status: planned, not implemented.** Phase 1 (single-tenant MVP) ships
first; we use it to run one pilot, validate the product, then execute this
plan. Every decision below is designed to preserve as much Phase 1 code as
possible.

**Start signal:** don't touch Phase 2 code until the 20-step rollout in
`docs/setup/rollout.md` has put real wallet passes in at least one
customer's phone, and the pilot bar has been open for ≥ 2 weeks with real
stamps. Earlier means you're optimizing before you know what to optimize.

---

## 1. Architecture at a glance

```
                              ┌─────────────────────────────┐
DNS  *.cafetone.app ──────────►  Fly app (single deployment) │
                              │                              │
                              │  subdomain middleware        │
                              │     ↓ resolves tenant_id     │
                              │                              │
customer ─► pilot.cafetone.app/join/    ──► tenant-scoped    │
barista  ─► pilot.cafetone.app/pwa/     ──► tenant-scoped    │
owner    ─► pilot.cafetone.app/admin/   ──► tenant-scoped    │
you      ─► admin.cafetone.app          ──► platform-scoped  │
new bar  ─► cafetone.app/signup         ──► onboarding       │
                              └─────────────────────────────┘
                                             ↓
                                         Postgres
                                 (every row has tenant_id)
```

One deployment, one database, one Apple Pass Type ID, one Google issuer —
all tenants share them. Per-tenant state lives in a `tenants` table and a
`tenant_id` column on every existing table.

## 2. The Apple Wallet reality check

This is the only genuinely hard constraint in Phase 2 and it shapes
everything else. **Read this before designing anything.**

Apple does **not** allow programmatic creation of Pass Type IDs. Every Pass
Type ID has to be registered in the Apple Developer portal by hand, with a
separately-issued signing certificate. There is no self-service API.

That leaves two architectures:

### 2a. "Cafetone is the issuer" (recommended)

- **One** Pass Type ID (`pass.com.cafetone.loyalty`), owned by you.
- **One** signing cert, one APNs key — the ones already in `secrets/`.
- From iPhone's point of view, every loyalty card is a Cafetone card.
- Each bar's identity comes from pass fields + branding:
  - `logoText` = bar short name
  - `backgroundColor` = bar brand color
  - `logo.png` / `strip.png` = bar logo, stored per-tenant on the volume
  - Primary field label = bar name
  - `webServiceURL` = `https://<subdomain>.cafetone.app/` — the subdomain
    tells the backend which tenant owns the pass

This is how Stocard and similar aggregators work. UX-wise it's fine — end
customers don't care about the cert holder; they care about the logo.

### 2b. "Each bar brings their own Apple Developer account"

- Truly white-label, truly the bar's brand in Wallet.
- Requires each bar to pay Apple \$99/yr and wait 24–48 h for approval.
- Cannot be finished in "3 minutes"; customer must upload their own cert.
- Reasonable as a "Pro" plan upgrade in **Phase 3**, not at launch.

**Decision: Phase 2 ships 2a. Phase 3 may add 2b as an option for bars that
ask.**

Google Wallet has no equivalent restriction — programmatic LoyaltyClass
creation per tenant under one issuer works out of the box.

## 3. Data model changes

New table:

```sql
create table tenants (
  id                 text primary key,        -- ulid
  subdomain          text not null unique,    -- 'pilot' in pilot.cafetone.app
  name               text not null,           -- 'Pilot Bar'
  short_name         text not null,           -- shown in wallet pass
  stamps_required    integer not null default 10,
  reward_text        text    not null default 'Free drink',
  brand_color        text    not null default '#212121',  -- hex, for wallet
  logo_path          text,                    -- relative to secrets volume
  google_class_id    text,                    -- set after bootstrap
  plan               text not null default 'trial' check (plan in ('trial','free','pro','suspended')),
  trial_ends_at      timestamptz,
  stripe_customer_id text,
  stripe_sub_id      text,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index tenants_subdomain_idx on tenants (subdomain);
```

Every existing table gains `tenant_id text not null references tenants(id) on delete cascade`:

- `customers` — unique on `(tenant_id, email)`, not globally
- `staff` — same
- `staff_sessions` — no explicit `tenant_id` needed; transitively scoped via
  `staff_id` (which already carries tenant). Lookups are by `session_hash`
  which is globally unique.
- `passes` — serial still globally unique (ULID)
- `apple_devices` — unchanged structurally, but device rows carry an implicit
  tenant via their pass (not a column; pass table scopes it)
- `stamps`, `redemptions` — cascade with customer, but keep `tenant_id` for
  fast per-tenant analytics
- The `config` table **goes away**. Its data is now per-tenant.

New role column on `staff`:

```sql
alter table staff add column role text not null
  default 'barista' check (role in ('admin','barista'));
```

Admins see `/admin/*`; baristas only `/pwa/`.

## 4. Subdomain routing

**DNS:** `*.cafetone.app` CNAME to the Fly app. Root + `www` point to a
marketing landing (can be a static Cloudflare page, doesn't have to be in
this app).

**TLS:** Fly supports wildcard certs via Let's Encrypt DNS-01. Provision
once:

```sh
fly certs add '*.cafetone.app'
# Follow Fly's DNS-01 challenge instructions in your DNS provider.
```

**Reserved subdomains** (not tenant slugs): `www`, `app`, `admin`, `api`,
`docs`. Refuse these at signup.

**Middleware** (new, ~30 lines in `src/lib/tenant.ts`):

```ts
// Extract subdomain from Host header, look up tenant, attach to request.
// 404 if subdomain doesn't map to an active tenant.
// Reserved subdomains route to platform-level handlers (marketing, signup,
// platform admin) and never touch the tenant lookup.
```

Every existing route gets the tenant from `req.tenant`, and every query
gains `where tenant_id = $X`. Decoration is centralized so route handlers
stay clean.

## 5. Onboarding flow (the 3-minute promise)

Landing at `cafetone.app` or `www.cafetone.app`:

```
[ Start your loyalty card program ]
```

Click → `/signup`:

1. **Account** — email, password (or passkey). Create `platform_user` row.
2. **Verify email** — magic link, same mechanism as staff auth.
3. **Pick subdomain** — live availability check against `tenants`. Suggest
   a slug from the bar name.
4. **Brand wizard** — bar name, short name, brand color (preset palette +
   custom), logo upload (stored on `secrets` volume as
   `secrets/tenant-logos/<tenantId>.png`).
5. **Program rules** — stamps threshold (default 10), reward text.
6. **Preview** — show a live mock wallet pass (reuse `/dev/pass/` renderer
   with tenant data). Check "this looks right" → confirm.
7. **Invite staff** — up to 3 emails (Free plan limit), optional now, can
   add later.
8. **Done** — redirect to `<subdomain>.cafetone.app/admin/`. Show the
   public signup URL (`<subdomain>.cafetone.app/join/`) and a download link
   for a print-ready QR poster PDF.

Behind the scenes on step 6 confirm:

- Create `tenants` row
- Create first `staff` row with `role=admin`
- Create Google LoyaltyClass via `ensureLoyaltyClass(tenant)`
- Store Apple pass artwork at tenant path
- Start 14-day trial
- Do **not** create Stripe subscription yet; start free

Total elapsed: 90–180 seconds if they have a logo ready.

## 6. Wallet integration under multi-tenant

### Apple

- `buildApplePkpass` takes a `tenant` parameter; reads `logo_path`,
  `short_name`, `brand_color`, `stamps_required`, `reward_text` from it
  instead of `config.bar.*`.
- `webServiceURL` in the pass becomes
  `https://<tenant.subdomain>.cafetone.app/`.
- APNs push uses the single topic (our Pass Type ID). The `apple_devices`
  rows are scoped by pass → tenant, so the fan-out already works.
- `signGdprToken` / `signPassQr` include tenant_id claim to prevent
  cross-tenant token use.

### Google

- LoyaltyClass per tenant: `<issuerId>.tenant_<tenantId>_v1`. The `_v1`
  suffix lets us version without breaking existing passes.
- Bootstrap runs in the onboarding flow, not as an admin CLI.
- LoyaltyObjects IDs: `<issuerId>.<pass.serial_number>` — serial is already
  globally unique (ULID), no change needed.
- Save-to-wallet JWT's `origins` field must include the tenant's subdomain.

## 7. Admin panels

**Tenant admin** (`<subdomain>.cafetone.app/admin/`) — built per tenant:

- `/admin/` — dashboard: today's stamps, today's redemptions, total
  customers, 7-day chart (pure SQL, no BI library)
- `/admin/customers` — paginated table, email search, per-row "delete
  (GDPR)" button wired to the same unsubscribe flow
- `/admin/staff` — list, invite (sends magic-link email), revoke, role edit
- `/admin/settings` — name, stamps_required, reward, brand color, logo
  re-upload
- `/admin/billing` — plan, trial countdown, "Upgrade to Pro" button →
  Stripe Checkout → return here
- `/admin/export` — one button: download CSV of customers + stamps (GDPR
  data portability)

**Platform admin** (`admin.cafetone.app/`) — for you:

- Tenants table with plan, MRR, last-stamp-at, status
- Impersonate button (sets session cookie scoped to that tenant's subdomain)
- Suspend / re-enable
- Per-tenant log tail (from centralized logger)

Both reuse the existing `staff` magic-link auth. Platform admin is a
special `platform_admin` table (or: a flag on a dedicated `staff` row on
a null-tenant row — cleaner to keep them separated).

## 8. Billing (Stripe)

Plans:

| Plan         | Price       | Limits                                    |
|--------------|-------------|-------------------------------------------|
| Trial        | free (14 d) | Pro features unlocked                     |
| Free         | \$0         | 1 staff, 100 customers, Cafetone branding |
| Pro          | ~\$29/mo    | Unlimited staff, unlimited customers,     |
|              |             | custom brand color, priority support      |
| Pro + custom | ~\$79/mo    | Custom domain (`loyalty.somebar.com`),    |
|              |             | own Apple Developer cert (Phase 3)        |

Stripe Checkout for conversion, Stripe Customer Portal for self-serve
plan changes. Webhook at `/api/stripe/webhook` updates `plan` column.

Downgrade behavior: if over limit, block **new** customers/staff creation
but never delete data. Show a banner in `/admin/`.

## 9. Phase 1 → Phase 2 migration plan

We'll ship Phase 1 to the pilot first. When we start Phase 2, the pilot
becomes the "default tenant" without downtime.

**Migration `003_multitenant.sql`** (002 is taken by `002_staff_sessions.sql`):

```sql
-- 1. New tables
create table tenants (...);       -- as above
create table platform_admins (...);

-- 2. Seed the pilot as the first tenant
insert into tenants (id, subdomain, name, short_name, stamps_required,
                     reward_text, plan)
select ulid(), 'pilot', bar_name, bar_name, stamps_required, reward_text,
       'free'
from config;

-- 3. Add tenant_id everywhere, backfill with the pilot's id, then NOT NULL
alter table customers add column tenant_id text;
update customers set tenant_id = (select id from tenants limit 1);
alter table customers alter column tenant_id set not null,
                     add foreign key (tenant_id) references tenants(id);

-- … same for staff, passes, stamps, redemptions.
-- apple_devices stays scoped via passes.serial_number (FK chain).
-- staff_sessions stays scoped via staff_id (FK chain).

-- 4. Swap unique constraints
alter table customers drop constraint customers_email_key;
create unique index customers_tenant_email_key
  on customers (tenant_id, lower(email)) where email is not null;

-- 5. Role column
alter table staff add column role text not null default 'barista'
  check (role in ('admin','barista'));
-- Promote the seeded pilot staff to admin:
update staff set role='admin' where id in (select id from staff limit 1);

-- 6. Drop config
drop table config;
```

Phase 1 code that references `config` table is deleted in the same PR.

## 10. PR sequence

Ship in independently-reviewable chunks. Each keeps `make test` green.

1. **`phase2/01-schema`** — migration 002, tenant middleware, tenant_id
   scoping on every existing query, Phase 1 becomes "default tenant" under
   a hardcoded subdomain. Dev loop unchanged; smoke test adapts to create
   a throwaway tenant per run.
2. **`phase2/02-onboarding`** — `/signup` + wizard at `cafetone.app`,
   creates tenants + first admin + Google LoyaltyClass. Logo upload to
   volume. Apple pass generation tenant-aware.
3. **`phase2/03-admin-panel`** — `/admin/*` routes + HTML pages: dashboard,
   customers, staff, settings.
4. **`phase2/04-platform-admin`** — `admin.cafetone.app` views +
   impersonation + suspend.
5. **`phase2/05-billing`** — Stripe integration, plan gating, trial clock.
6. **`phase2/06-wildcard-tls`** — Fly certs, DNS instructions, marketing
   landing. Production ready.

Approximate effort: 2–3 focused weeks end-to-end. Single developer, no
team overhead.

## 11. What we preserve from Phase 1

Big list, because this is why we bother shipping Phase 1 first:

| Preserved                                        | Changes needed                        |
|--------------------------------------------------|---------------------------------------|
| DB schema (7 of 7 tables carry over)             | Add `tenant_id` column + index        |
| `src/lib/apple-pass.ts`                          | Accept tenant, read branding from it  |
| `src/lib/apple-apns.ts`                          | None — APNs is per-device, not tenant |
| `src/lib/google-wallet.ts`                       | Class/object IDs include tenant       |
| `src/lib/wallet-sync.ts`                         | Query scoped by tenant                |
| `src/lib/jwt.ts`                                 | Add `tid` claim                       |
| `src/lib/email.ts`                               | None (from-address could be dynamic)  |
| `src/lib/rate-limit.ts`                          | Scoped query                          |
| `src/routes/passkit-ws.ts` (six Apple endpoints) | Extract tenant from subdomain         |
| `src/routes/join.ts`                             | Tenant from middleware                |
| `src/routes/stamp.ts` / `redeem.ts`              | Tenant + token check matches          |
| `src/routes/staff.ts`                            | Scope login to tenant subdomain       |
| `src/routes/unsubscribe.ts`                      | Tenant-scoped delete                  |
| `src/routes/pass-download.ts`                    | Tenant from subdomain                 |
| `src/routes/dev.ts`                              | Multi-tenant simulator                |
| Barista PWA (static)                             | Brand-color CSS variables injected    |
| `/join/` page                                    | Tenant name + logo injected           |
| `make test` smoke                                | Creates throwaway tenant per run      |
| Postmark email                                   | Unchanged                             |
| Fly deploy pipeline                              | Add wildcard cert + DNS               |

New code (~estimated):

- `src/lib/tenant.ts` (~50 LOC) — subdomain → tenant lookup + cache
- `src/routes/signup.ts` (~200 LOC) — onboarding wizard API
- `src/routes/admin.ts` (~300 LOC) — admin panel API (CRUD + aggregates)
- `src/routes/platform-admin.ts` (~150 LOC)
- `src/routes/billing.ts` (~150 LOC) — Stripe Checkout + webhook
- `public/signup/` — wizard frontend (~300 LOC vanilla HTML/JS)
- `public/admin/` — admin panel frontend (~400 LOC)
- `public/www/` — marketing landing (or host on Cloudflare Pages)

Total new code: ~1,500 LOC on top of ~2,500 LOC existing. Bulk of the
work is the onboarding wizard and the admin panel — both are straight-
forward CRUD with no wallet-integration landmines.

## 12. Open questions — decide before kicking off

These need the user's call. I'll ask, not guess:

- **Domain**: is it `cafetone.app`? If not, what? Must be finalized before
  wildcard cert provisioning.
- **Pricing**: confirm plan structure in section 8 or redesign. Who pays
  VAT — you via Stripe Tax, or the bar's responsibility?
- **Jurisdictions**: Czech / EU only at first, or global? Affects Stripe
  setup, GDPR phrasing, privacy policy template.
- **Custom domains** (e.g. `loyalty.barname.com`): in scope for Phase 2 or
  deferred to Phase 3? Adds ACME automation + custom-domain DB column.
- **Free plan**: exists, or trial-to-paid only? Free plan = longer tail of
  zombie tenants, more support.
- **Bring-your-own Apple cert** (architecture 2b from §2): Phase 3 or
  never? Decides whether platform-admin UI needs a cert-upload path later.
- **First marketing page**: do I build a minimal one in `public/www/` or do
  you handle that on a separate CMS / Framer / Cloudflare Pages?
- **Language**: UI in Czech only, EN only, or both from day one? Affects
  templates for onboarding + admin.

Answers to these unblock `phase2/01-schema`. The middleware + schema work
doesn't depend on UX language decisions, but the onboarding wizard does.

## 13. Non-goals for Phase 2

Explicitly **not** doing these, even though they might come up:

- Native mobile apps (iOS / Android). PWA and wallet passes only.
- In-pass push messages to customers ("come back — 2 stamps from reward").
  Possible but Wallet push UX is clunky and often ignored.
- Referrals, coupons, tiers. Still Phase 1 scope guardrails apply.
- Customer-facing web account. Still no.
- Payments flowing through the platform (i.e. the bar charging customers
  through Cafetone). We're a loyalty tool, not a POS.
- Franchise / multi-location for one brand. Treat each location as its own
  tenant for now. (Could revisit in Phase 3 as "tenant groups".)

## 14. Risks I want to flag

- **Apple cert rotation**: our single Pass Type ID's cert expires every
  year. When it does, every pass already in customer wallets continues to
  work (Apple caches signatures), but newly issued passes fail until we
  rotate. Needs a calendar reminder + a zero-downtime rotation procedure
  documented in `docs/setup/apple-wallet.md`.
- **Subdomain squatting**: once we launch, brand-name subdomains become
  valuable. Reserve common bar chain names before public launch.
- **Per-tenant pass artwork on a single volume**: if the volume dies we
  lose everyone's logos. Fine for Phase 2 (Fly snapshots), but revisit S3
  at ~100 tenants.
- **Support load from Apple Wallet pass issues**: each support ticket
  touches Apple's sometimes-flaky pass installation UX. Budget for a
  playbook (and keep `docs/setup/apple-wallet.md`'s troubleshooting
  matrix updated from real tickets).
