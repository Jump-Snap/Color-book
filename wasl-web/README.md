# Wasl independent web and Android

Arabic mobile-first order workspace using React/Vite, Supabase Auth/Postgres/private Storage, and Android SMS/notification forwarding. It does not call ChatGPT, Macaly, Gemini or WhatsApp. OCR runs on the device using Tesseract; PDF text is extracted before trying OCR.

## Build

Node 24 and pnpm 11.25 are used in CI.

```
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm test
pnpm build
```

Set the Supabase URL and **publishable** key in the build environment. Never put a service-role key, Firebase private key, sheet bridge secret, customer export or password in frontend variables or Git. `dist/` can be hosted on Cloudflare Pages; build root `wasl-web`, command `pnpm build`, output `dist`. Local development: `pnpm dev`.

The build downloads Arabic/English trained data from the official Tesseract `tessdata_fast` repository. Worker/WASM files come from the installed npm packages. These are served locally at runtime; there are no external OCR API calls or paid OCR keys. `public/ocr/sources.json` records language checksums. The first OCR run downloads the language files to the device and may take time.

## Backend and deployment

Apply migrations in `supabase/migrations` in order. Deploy the `wasl` Edge Function with `index.ts`, `domain.ts` (a copy of `shared/domain.ts`) and `push.ts`. JWT verification is disabled at the platform boundary because the router supports native device tokens and a cron secret; every route performs its own authentication. Browser actions verify Supabase user JWTs; devices only receive scoped postal ingestion, health, FCM registration and their own alerts.

Private sheets use the existing signed Apps Script bridge. Store its secret server-side in `wasl_private.sheet_secrets`, bound to the exact spreadsheet ID. Pasting a URL cannot grant access to an arbitrary private spreadsheet. The already-authorized sheet is configured during migration; another private sheet requires granting access first. The original landing-page → Apps Script → Sheets/Telegram path is preserved. Server jobs pull Sheets every selected 1–1440 minutes, including confirmation changes, with a per-connection lease. Final/shipped statuses never regress during sheet import; unrecognized statuses are reported instead of silently becoming new orders.

Store `wasl_cron` (a random 32-byte token) and `wasl_firebase` (the existing FCM service-account JSON) in Supabase Vault. Enable `pg_cron` and `pg_net`, then schedule an authenticated POST to `/functions/v1/wasl/tick` each minute. The tick checks connection due times, prepares overdue alerts, sends the FCM outbox and processes approved file deletion jobs. Firebase does not require a ChatGPT subscription. Revoke the one-time bootstrap token after creating the administrator.

## Native Android

The APK requires a verified production frontend origin:

```
gradle -PwaslWebOrigin=https://your-site.pages.dev :app:assembleDebug :app:lintDebug
```

CI reads the public repository variable `WASL_WEB_ORIGIN`. Until hosting is connected its fallback is `https://example.invalid`; that artifact is for native tests and **must not be shipped as a working release**. Pairing allows only the configured HTTPS origin and keeps passwords/session JWTs inside the WebView. WhatsApp accessibility classes and manifest service are removed.

The new APK reads all selected historical postal SMS, previews them in pages of 50, and uploads acknowledged batches without discarding an interrupted import. New Google/Samsung SMS notifications support expanded message bundles, Arabic digits and listener reconnects. A 15-minute Android job retries offline queues, separately from immediate notification forwarding. Push is delivered through FCM when the UI is closed, subject to Android permissions, connectivity and force-stop/battery restrictions. Actual Samsung hardware delivery must be checked after installing the configured APK; emulator tests cannot prove this.

## Files and deletion

One canonical waybill per workspace/tracking code; repeated upload offers explicit update or rejection. Conflicts with another order never silently reassign files. Matching is by a unique normalized recipient phone, with manual review for ambiguous/missing numbers. Existing archival attachments remain linked to their original order.

Automatic retention is **off by default**. Date-range deletion first previews at most 500 explicit files and requires confirmation. Orders, tracking codes and event history remain. Object deletion uses Storage's API; SQL only updates metadata/queues. Shared file objects must remain until their last active reference is removed. Never run retention against migrated customer data as a test.

## Verification

`pnpm test` covers phone/status/tracking parsing and non-regression. `supabase/tests/reconciliation.sql` runs transactional backend tests and rolls back synthetic data. Do not publish actual customer PDFs, screenshots or exports as fixtures. The native workflow runs Android lint, a build, and instrumentation for permission handoff, origin restrictions and a historical inbox larger than 500 messages.
