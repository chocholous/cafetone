# Google Wallet setup playbook

Goal: a Google Wallet Loyalty class that customers can save their loyalty
object into, with server-side updates via the Wallet Objects REST API.

Budget: free (no Google Cloud billing needed for Wallet API). Issuer
approval for production takes 1–2 weeks. **Apply early.** Meanwhile you can
develop against a test-mode issuer with zero approval.

---

## 1. Google Pay & Wallet Console  **[you]**

https://pay.google.com/business/console — sign in with your Google account,
agree to terms.

- Navigate to **Google Wallet API** → **Issuer account setup**.
- Fill business name, website, logo, country. Submit.
- You get an **Issuer ID** immediately — usable in test mode.
- Production approval comes later via email. Keep working in test mode until
  it arrives.

Note the issuer ID (looks like `3388000000022000000`). Save it — goes in
`.env` as `GOOGLE_ISSUER_ID`.

## 2. Google Cloud project + service account  **[you]**

https://console.cloud.google.com/

- Create a new project (or reuse an existing one) — name it `cafetone`.
- Enable the **Google Wallet API**: APIs & Services → Library → search
  "Google Wallet" → Enable.
- IAM & Admin → **Service Accounts** → **+ Create Service Account**:
  - Name: `cafetone-wallet`
  - Skip role grants for now.
- Open the service account → **Keys** → **Add Key → JSON**. Download.
- Save as `secrets/google-service-account.json`.

## 3. Link the service account to the issuer  **[you]**

Back in Google Pay & Wallet Console → Issuer account → **Users** →
**+ Invite user**. Paste the service account email (looks like
`cafetone-wallet@<project>.iam.gserviceaccount.com`). Role: **Admin**.

This is the step that gets missed most often. Without it you get 403 on
every API call.

## 4. Fill .env  **[me]**

```ini
GOOGLE_ISSUER_ID=3388000000022000000
GOOGLE_CLASS_ID_SUFFIX=cafetone_stamp_card_v1
GOOGLE_SERVICE_ACCOUNT_PATH=secrets/google-service-account.json
```

## 5. Create the loyalty class  **[me]**

Classes must exist before objects. One-off bootstrap:

```sh
npm run google:bootstrap
# → "loyalty class ready"
```

This creates a class at `<issuer_id>.cafetone_stamp_card_v1` with status
`UNDER_REVIEW`. That status is fine for test accounts and for development.
Once the issuer is approved for production, the class auto-promotes.

If you need to re-edit class attributes (colors, logo), tweak `classBody()`
in `src/lib/google-wallet.ts` and rerun. The bootstrap treats the class as
existing and does nothing; to force update, temporarily switch the `ensureLoyaltyClass`
call in `scripts/google-bootstrap.ts` to a PATCH — ask the user first because
class updates propagate to all existing passes.

## 6. First real save-to-wallet test  **[me + user]**

Wallet passes need HTTPS. Tunnel:

```sh
make tunnel
```

Set `PUBLIC_BASE_URL` to the tunnel URL, restart.

**[you]** On an Android phone, open `<tunnel-url>/join/`, enter email, tick
consent. The page detects Android, calls `/join` with `platform: "google"`,
receives a `saveUrl` like `https://pay.google.com/gp/v/save/<JWT>`. Tapping
that link opens Google Wallet → **Add to Google Wallet** → card appears.

**[you]** In the barista PWA (`<tunnel-url>/pwa/`), sign in and scan the
loyalty card's QR. The card should refresh in Google Wallet within ~5 s.

## 7. Test-mode limitations  **[context]**

Until your issuer is approved for production:

- Only users you add under **Wallet Console → Test users** can save objects.
- The card shows an "untrusted issuer" notice in the wallet.
- Everything else — JWT save links, object updates, QR payloads — works
  identically to production.

Add your test Android account email under Wallet Console → Test users
before trying step 6.

## 8. Production hand-off  **[later]**

When the approval email arrives:

- In `src/lib/google-wallet.ts`, `classBody()` sets `reviewStatus:
  "UNDER_REVIEW"` — change to `"APPROVED"` or leave; Google promotes
  automatically once the issuer is approved.
- Update brand assets (`programLogo.sourceUri.uri`) to a permanent public URL.
  During dev it points at `/public/join/logo.png`; for production this has
  to be a stable URL served from your deployed host.

## 9. Troubleshooting  **[me]**

| Symptom                                    | Likely cause                                 |
|--------------------------------------------|----------------------------------------------|
| `403 Forbidden` on any API call            | Service account not invited to issuer        |
|                                            | (step 3), or wrong issuer ID                 |
| `400` on `buildSaveLink`, "aud"/"iss" error | Service account JSON wrong or passphrase     |
|                                            | got into `private_key`                       |
| Class create 200, object create 404        | Class ID format wrong — must be              |
|                                            | `<issuerId>.<suffix>`                        |
| Save link opens "Something went wrong" in  | `origins` in the JWT must match the domain   |
| Google Wallet                              | the save link is clicked from. We derive it  |
|                                            | from `PUBLIC_BASE_URL`; keep it in sync.     |
| Card saves but never updates               | `upsertLoyaltyObject` errored silently —     |
|                                            | check server logs for                        |
|                                            | `[wallet-sync] google error`                 |

Quick inspect:

```sh
# Show all loyalty objects for this issuer
curl -H "Authorization: Bearer $(gcloud auth print-access-token \
  --impersonate-service-account=<sa-email>)" \
  "https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject?classId=<ISSUER_ID>.cafetone_stamp_card_v1"
```
