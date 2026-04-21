# Deploy to Fly.io playbook

Goal: one deployed instance with HTTPS on a real domain, managed Postgres,
and secrets uploaded. Fly.io is the recommended host — cheap, single binary
CLI, Docker-native, has managed Postgres, and their free TLS supports the
wallet web-service HTTPS requirement.

Alternatives exist (Hetzner, Railway, Render, plain EC2). The Dockerfile is
generic — any of them work with the same env vars.

Budget: ~\$5/month for the app VM + \$0 for the free Postgres tier (tiny
amounts), or ~\$15/month for the next Postgres tier with backups.

---

## 1. Install and authenticate `flyctl`  **[you]**

```sh
curl -L https://fly.io/install.sh | sh
fly auth login
```

## 2. Create the app  **[me]**

From the repo root:

```sh
fly launch --no-deploy --copy-config --name cafetone
```

Accept defaults except:
- **Region**: pick the region closest to the bar. For Europe, `fra` (Frankfurt).
- **Postgres**: say **yes**. Pick the development tier unless the user wants
  backups from day one.
- **Redis**: **no**.
- **Deploy now?**: **no**. We need to upload secrets first.

This creates `fly.toml`. I'll patch it below for our specifics.

## 3. Patch fly.toml  **[me]**

Set the public URL + volume mount for certs. The repo's Dockerfile already
copies `migrations/` and `public/`; we just need the runtime secrets mounted.

```toml
# fly.toml (patch on top of what `fly launch` generated)
app = "cafetone"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  # PUBLIC_BASE_URL is set below after we know the domain.

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1

[[mounts]]
  source = "cafetone_secrets"
  destination = "/app/secrets"
```

Create the volume:

```sh
fly volumes create cafetone_secrets --size 1 --region fra
```

## 4. Upload secrets as Fly secrets  **[me]**

Non-file secrets go via `fly secrets set`:

```sh
fly secrets set \
  APP_JWT_SECRET="$(openssl rand -base64 48)" \
  APPLE_PASS_TYPE_ID="pass.com.yourdomain.cafetone" \
  APPLE_TEAM_ID="..." \
  APPLE_ORG_NAME="..." \
  APPLE_SIGNER_KEY_PASSPHRASE="..." \
  APPLE_APNS_KEY_ID="..." \
  APPLE_APNS_TEAM_ID="..." \
  GOOGLE_ISSUER_ID="..." \
  GOOGLE_CLASS_ID_SUFFIX="cafetone_stamp_card_v1" \
  POSTMARK_TOKEN="..." \
  EMAIL_FROM="loyalty@yourdomain.com" \
  BAR_NAME="..." \
  BAR_SHORT_NAME="..." \
  STAMPS_REQUIRED="10" \
  REWARD_TEXT="Free coffee" \
  STAMP_COOLDOWN_SECONDS="300" \
  DEV_MOCK_WALLETS="false"
```

File secrets (certs, keys, JSON) go on the volume. SSH in and upload:

```sh
fly ssh console
mkdir -p /app/secrets
exit

# Copy from local machine (run from repo root):
fly ssh sftp shell <<'EOF'
put secrets/pass-cert.pem    /app/secrets/pass-cert.pem
put secrets/pass-key.pem     /app/secrets/pass-key.pem
put secrets/apple-wwdr.pem   /app/secrets/apple-wwdr.pem
put secrets/apns-authkey.p8  /app/secrets/apns-authkey.p8
put secrets/google-service-account.json /app/secrets/google-service-account.json
EOF
```

Then set the paths (they're gitignored so they're not in the image):

```sh
fly secrets set \
  APPLE_SIGNER_CERT_PATH="secrets/pass-cert.pem" \
  APPLE_SIGNER_KEY_PATH="secrets/pass-key.pem" \
  APPLE_WWDR_CERT_PATH="secrets/apple-wwdr.pem" \
  APPLE_APNS_KEY_PATH="secrets/apns-authkey.p8" \
  GOOGLE_SERVICE_ACCOUNT_PATH="secrets/google-service-account.json"
```

## 5. Map a domain  **[you + me]**

**[you]** Point a DNS A-record for `loyalty.yourdomain.com` at the app's
address shown by `fly ips list`.

**[me]** Once DNS resolves:

```sh
fly certs add loyalty.yourdomain.com
fly secrets set PUBLIC_BASE_URL="https://loyalty.yourdomain.com"
```

## 6. Deploy  **[me]**

```sh
fly deploy
```

Watch the rollout. First boot takes ~60 s. Check health:

```sh
curl https://loyalty.yourdomain.com/healthz
# {"ok":true}
```

## 7. Run migrations + seed production staff  **[me]**

```sh
fly ssh console
cd /app
npx tsx scripts/migrate.ts
# seed the real barista email(s):
psql "$DATABASE_URL" -c \
  "insert into staff (id, email) values (gen_random_uuid()::text, 'you@bar.com');"
exit
```

## 8. Bootstrap the Google Wallet class in prod  **[me]**

```sh
fly ssh console
cd /app
npx tsx scripts/google-bootstrap.ts
exit
```

## 9. Scale + backups  **[decision point]**

The default is 1 machine in 1 region. That's right for one bar. Don't scale
horizontally: every extra instance is pointless and costs money.

For DB backups, the dev-tier Postgres has none. For production, upgrade:

```sh
fly postgres list
fly postgres update --vm-size shared-cpu-1x --volume-size 3 <app-name>
fly postgres config update --wal-level replica <app-name>
```

Or export a daily dump to S3 — ask if the user wants that as a GitHub Action.

## 10. Troubleshooting  **[me]**

| Symptom                               | Command                                      |
|---------------------------------------|----------------------------------------------|
| Boot fails                            | `fly logs` — usually missing env var         |
| "file not found" for a cert           | File got `put` to wrong path; `fly ssh ls`   |
|                                       | `/app/secrets`                               |
| Migrations never applied              | `fly ssh console` → `npx tsx scripts/migrate.ts` |
| Can't reach Postgres                  | `fly postgres attach <pg-app>`                |
|                                       | sets `DATABASE_URL` automatically             |
| Cert renewal failing                  | `fly certs show loyalty.yourdomain.com`      |

Rollback:

```sh
fly releases
fly deploy --image registry.fly.io/cafetone:deployment-<prev>
```
