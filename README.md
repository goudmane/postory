# Mailroom — early implementation

This repository is the first working slice of the [product and architecture plan](docs/plan.md). It is **not a production-ready email client**. It supports owner login, manual password/app-password IMAP+SMTP setup, live folder/message listing, plain-text reading, flags, server-side draft autosave, one-recipient plain-text sending, SMTP activity, and cautious Sent-folder filing.

## Run with Docker

1. Copy `.env.example` to `.env`.
2. Generate a 32-byte base64 key with `openssl rand -base64 32`; put it in `APP_ENCRYPTION_KEY`. Set a strong `POSTGRES_PASSWORD` and use the **same** value in `DATABASE_URL` (URL-encode special characters in the URL).
3. Run `docker compose up -d --build`.
4. Open `http://localhost:3000` **on the host running Docker**. Create the owner login, then add a mailbox with IMAP/SMTP details.

The reference Compose binds the web UI to `127.0.0.1` only. To use another machine, put it behind an HTTPS reverse proxy and set `APP_ORIGIN=https://your-hostname`, `COOKIE_SECURE=true`. Restrict outbound destinations with an egress firewall; host validation in the app is only one layer. Do not expose PostgreSQL or Redis. A database backup must include the encryption key or mailbox credentials and saved MIME cannot be decrypted after restore.

## Local development

Use Node 24 and PostgreSQL. `npm ci`, set environment values from `.env.example` for local host, then `npm run dev:api` and `npm run dev:web` in separate terminals. Set `API_INTERNAL=http://127.0.0.1:3001` for Nuxt. `npm run check` validates API types; `npm run build` builds both apps. No host npm installation is needed for Docker use.

## Current behavior and limitations

- IMAP reads are live, bounded to 40 messages per page. There is no cached incremental sync, IDLE, unified Inbox, or offline mode yet. Refresh manually. List/open/flag requests check UIDVALIDITY and refuse stale selections, but a full reconciliation engine is still pending.
- Only password/app-password authentication is implemented. Gmail/Microsoft OAuth, automatic discovery and configurable special-folder mapping are pending. TLS is mandatory: implicit TLS or STARTTLS with certificate verification.
- The message viewer displays plain text only; HTML, attachment downloads/uploads, conversations, reply/forward, multi-recipient/Cc/Bcc and advanced search are pending. A message with no plain-text part is intentionally not rendered as HTML.
- Drafts are stored in PostgreSQL and autosaved with revision checks. Their body is currently **not encrypted at rest**; host access and backups can reveal it. Do not use sensitive mail here until draft encryption and recovery testing are complete. Browser offline draft recovery is also pending.
- SMTP sends exactly one recipient per draft. Each draft can have one send attempt, preventing accidental repeat submission. The SMTP result can be `uncertain` if the connection fails at a stage where acceptance cannot be proved. Check the recipient/provider before creating a new draft. A successful SMTP response is acceptance by the outgoing server, never proof of recipient delivery.
- The app probes the mapped `\\Sent` folder for the Message-ID, then appends the saved MIME if absent. Some providers file asynchronously; this early implementation may still produce duplicate Sent copies. The activity page offers a separate filing check without a second SMTP send. Do not use it for critical correspondence until provider tests pass.
- Activity records only mail submitted through this app. It cannot see mail sent by other applications through OVH SMTP.
- No migrations framework, provider test matrix, full audit, key rotation, password reset, MFA, attachments, background worker or production load validation yet. Do not expose this build to the public Internet.

## Development order

Next: UIDVALIDITY-aware metadata synchronization and folder role mapping; durable draft encryption/recovery; provider-tested SMTP/Sent behavior; isolated HTML rendering and streaming attachments; reply/threading/search; OAuth and autodiscovery; diagnostics, mobile/accessibility and production security review. The complete sequence and release gates are in the plan.

## Security model in this build

App password hashes use Argon2id. Mailbox passwords and immutable outgoing MIME are encrypted with AES-256-GCM; key material is outside PostgreSQL. Sessions are hashed in the database and sent as HttpOnly SameSite cookies. Unsafe methods require same-origin requests; login is rate limited. A message body is returned as JSON plain text and rendered as escaped Vue text. Direct mail host IPs and private DNS resolutions are refused by default; this also prevents on-prem mail hosts until an explicit admin policy is built.
