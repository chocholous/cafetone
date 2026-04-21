# Apple Wallet setup playbook

Goal: real `.pkpass` files installable on iOS, with server-side updates via
APNs silent push. From zero to first successful install on a real iPhone.

Budget: $99/yr Apple Developer membership, ~3 hours hands-on spread across
2 days (Apple enrollment takes 24–48 h).

---

## 1. Enrol in Apple Developer Program  **[you]**

https://developer.apple.com/programs/enroll/ — personal or business account.
Pay, wait for approval email. Nothing in this repo works until this is done.

## 2. Register a Pass Type ID  **[you]**

https://developer.apple.com/account/resources/identifiers/list/passTypeId

- Click **+**, choose "Pass Type IDs".
- Identifier: `pass.com.<yourdomain>.cafetone` (must start with `pass.`).
- Description: `Cafetone Loyalty`.
- Save. Note the exact identifier.

## 3. Generate the signing certificate  **[you]**

- On your Mac: open **Keychain Access** → Certificate Assistant → **Request
  a Certificate From a Certificate Authority**. Enter your email, choose
  "Saved to disk", get a `.certSigningRequest` file.
- Back in the Apple portal, open the Pass Type ID you just created, click
  **Create Certificate**, upload the CSR, download the `.cer`.
- Double-click the `.cer` to import to Keychain. Expand it, right-click the
  certificate → **Export** → `.p12` (set a passphrase; remember it).

## 4. Get the WWDR intermediate certificate  **[you]**

https://www.apple.com/certificateauthority/ → **Worldwide Developer Relations
— G4** → download the `.cer`.

## 5. Convert everything to PEM  **[me]**

Once the user has dropped the three files somewhere on disk, I run:

```sh
mkdir -p secrets
# signer: extract cert + key from .p12
openssl pkcs12 -in <user-path>/PassCert.p12 -clcerts -nokeys \
  -out secrets/pass-cert.pem -passin pass:<passphrase>
openssl pkcs12 -in <user-path>/PassCert.p12 -nocerts -nodes \
  -out secrets/pass-key.pem  -passin pass:<passphrase>
# wwdr: .cer → .pem
openssl x509 -in <user-path>/AppleWWDRCAG4.cer -inform DER \
  -out secrets/apple-wwdr.pem
chmod 600 secrets/*.pem
```

Verify the signer cert matches the Pass Type ID:

```sh
openssl x509 -in secrets/pass-cert.pem -noout -subject \
  | grep -o 'UID=pass\.[^,]*'
```

## 6. APNs auth key  **[you]**

https://developer.apple.com/account/resources/authkeys/list

- **+**, name it `Cafetone Wallet Push`, tick **Apple Push Notifications
  service (APNs)**. Download the `.p8` **immediately** — you can't redownload.
- Note the **Key ID** (e.g. `ABC123DEFG`) and your **Team ID** (top-right of
  the developer portal).

Drop the `.p8` at `secrets/apns-authkey.p8`.

## 7. Pass artwork  **[you]**

Drop PNGs into `assets/apple-pass/`:

| File          | Size   | Required |
|---------------|--------|----------|
| `icon.png`    | 29×29  | yes      |
| `icon@2x.png` | 58×58  | yes      |
| `icon@3x.png` | 87×87  | no       |
| `logo.png`    | ≤160×50| recommended |
| `logo@2x.png` | retina | recommended |

Transparent PNGs. Dark-friendly (pass background is `#212121`).

## 8. Fill .env  **[me]**

Update the Apple section of `.env`:

```ini
APPLE_PASS_TYPE_ID=pass.com.yourdomain.cafetone
APPLE_TEAM_ID=ABCDE12345
APPLE_ORG_NAME=Your Bar Name
APPLE_SIGNER_CERT_PATH=secrets/pass-cert.pem
APPLE_SIGNER_KEY_PATH=secrets/pass-key.pem
APPLE_SIGNER_KEY_PASSPHRASE=<the passphrase from step 3>
APPLE_WWDR_CERT_PATH=secrets/apple-wwdr.pem
APPLE_APNS_KEY_PATH=secrets/apns-authkey.p8
APPLE_APNS_KEY_ID=ABC123DEFG
APPLE_APNS_TEAM_ID=ABCDE12345
```

Then flip dev mock off so real Apple is exercised:

```ini
DEV_MOCK_WALLETS=false
```

## 9. First real install test  **[me + user]**

Wallet passes require HTTPS and a public URL. Use a tunnel:

```sh
make tunnel                       # prints an https://...trycloudflare.com URL
```

Edit `.env`, set `PUBLIC_BASE_URL` to the tunnel URL, restart the server.

**[you]** On an iPhone (Safari, not Chrome), open
`<tunnel-url>/join/`, sign up with a real email (apple detected by UA),
tap **Add to Apple Wallet** — the pkpass should download and prompt you to
add it. Tap **Add** in the top-right.

**[you]** Back in your PWA (`<tunnel-url>/pwa/`), sign in and scan the pass
QR — stamps should climb. Within ~5 s the pass in Wallet should refresh.

## 10. Troubleshooting  **[me]**

| Symptom                                    | Likely cause                              |
|--------------------------------------------|-------------------------------------------|
| "Sorry, your Pass cannot be installed"     | Signer cert doesn't match Pass Type ID,   |
|                                            | or WWDR cert is wrong generation (need G4) |
| Pass installs but never updates            | APNs JWT wrong (check Key ID, Team ID),   |
|                                            | or `apns-topic` ≠ Pass Type ID,            |
|                                            | or device never registered (check         |
|                                            | `apple_devices` table)                    |
| `410` from APNs                            | Device token expired — we auto-prune;     |
|                                            | user needs to reinstall pass              |
| `400` from APNs with "DeviceTokenNotForTopic" | `apns-topic` in `apple-apns.ts` must    |
|                                            | equal `APPLE_PASS_TYPE_ID`                |
| Pass installs, QR looks expired            | `PASS_QR_JWT_TTL_SECONDS` too short — the |
|                                            | pass refreshes QR on wallet open via      |
|                                            | PassKit WS GET /v1/passes/…               |

Check the `apple_devices` table to verify device registration hit our web
service:

```sh
psql "$DATABASE_URL" -c 'select * from apple_devices'
```
