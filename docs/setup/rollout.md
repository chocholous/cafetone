# Rollout — od commitu k živému baru

Dvacet kroků od teď ke kartám v telefonech reálných zákazníků. Detaily každé
fáze v samostatných playboocích (`apple-wallet.md`, `google-wallet.md`,
`deploy-fly.md`, `launch-checklist.md`).

1. **Dnes:** zřiď Apple Developer ($99/rok, schválení 1-3 dny, běží na pozadí).
2. **Dnes:** Google Pay & Wallet Console → Issuer ID dostaneš hned, production schválení 1-2 týdny.
3. **Dnes:** Google Cloud → nový projekt → enable Wallet API → service-account JSON.
4. **Dnes:** v Wallet Console pozvi service-account email jako **Admin** (nejčastější chyba = 403).
5. **Dnes:** Fly.io + Postmark signup.
6. **Dnes:** kup doménu (`APPLE_PASS_TYPE_ID` potřebuje reverse DNS — např. `pass.cz.tvujbar.cafetone`).
7. **Já [20 min]:** `fly launch` + `fly deploy` s `DEV_MOCK_WALLETS=true` → dostaneš `cafetone.fly.dev`.
8. **Ty:** otestuj mock flow z telefonu přes tu URL.
9. **Doména:** `fly certs add loyalty.tvujbar.cz` + CNAME záznam v DNS (~24 h propagace).
10. **Postmark:** verify domain + DKIM DNS záznam → reálné maily baristovi.
11. **Po Apple schválení:** Pass Type ID + CSR přes Keychain Access → `.p12`, WWDR G4 `.cer`, APNs `.p8`, ikony PNG.
12. **Já:** konverze certů na PEM, upload do Fly volume, `fly secrets set DEV_MOCK_WALLETS=false`.
13. **Test:** iPhone v Safari (ne Chrome) → `/join/` → Add to Apple Wallet → sken QR v `/pwa/`.
14. **Google Wallet (hned, nečeká na prod):** `npm run google:bootstrap` vytvoří LoyaltyClass.
15. **Ty:** přidej svůj Android Google account do **Test users** v Wallet Console.
16. **Test Android:** Save to Google Wallet link → pass v telefonu → sken z PWA.
17. **Po Google production** (týden 2-4): "untrusted issuer" notice zmizí automaticky.
18. **Launch:** insert reálných barista emailů do `staff` tabulky (`fly ssh console` + `psql`).
19. **Launch:** vytiskni A4 QR poster s URL `/join/` + brandingem, pověs za bar.
20. **Launch:** cron `pg_dump → S3 / Hetzner Storage Box` (Fly dev-tier Postgres nemá backupy; bez tohohle jedna ztráta = všichni zákazníci pryč).
