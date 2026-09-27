# Self-hosted mail application: product, UX, and implementation plan

**Planning draft for review — 27 September 2026. No implementation code.**

## Decisions and assumptions to review

- A self-hosted **mail client**, not an SMTP server or mail-server administration suite. IMAP owns mailbox state; SMTP submission accepts outbound messages; PostgreSQL stores a rebuildable index plus app-owned settings, drafts, outbox, and diagnostics.
- One app login may own several mail accounts. V1 is single-user-friendly but supports multiple app users with strict tenant boundaries. Mailbox credentials are separate from app credentials. Admins see operational metrics, never another user's message content by default.
- Docker Compose is the supported first deployment. Caddy provides HTTPS in the reference setup; deployments behind existing reverse proxies can omit it. Production needs a domain, HTTPS, persistent volumes, backups, and outbound reachability to providers.
- V1 supports generic IMAP/SMTP password or app password and OAuth2 for Gmail and Microsoft. Provider integration is gated by actual interoperability tests; some Microsoft organizational accounts may require tenant approval. No promise of universal autodiscovery.
- V1 uses server-side metadata caching and durable server-side drafts; browser offline access to existing lists is limited and privacy aware. Full offline send and full-text local search are later features.
- A successful SMTP final response means **accepted by the submission server**, not delivered to the recipient. Sent-folder filing is a separate tracked step; a failed or uncertain send must never be blindly retried.
- First release target: one trusted household or small team installation, then broader multi-user deployments after load and isolation tests. No public multi-tenant service claim.

## 1. Product vision

A dependable everyday webmail with a quiet interface and an opt-in explanation of mail transport. Success means a new user can connect a mailbox and use it daily, while a technically skilled user can determine whether an outbound message was accepted, whether a Sent copy was filed, and why a connection failed. Trust is measured by correct state, clear uncertainty, and recoverable drafts, not by animation or feature count.

## 2. User personas

| Persona | Main job | Critical concern |
| --- | --- | --- |
| Everyday mailbox owner | Read, search, reply across accounts | No lost mail, simple status and setup |
| Small-business operator | Manage reception/reservations mail | Correct identity, fast triage, reliable Sent |
| Developer | Diagnose application-originated SMTP and mail behavior | Stage timings, sanitized responses, correlation IDs |
| Self-hosting admin | Deploy, upgrade, investigate sync | Health, backups, limits, observability without content exposure |
| Keyboard / screen-reader / mobile user | Complete the same core tasks | Focus order, labels, adaptable layout, safe touch targets |

## 3. Primary user journeys

1. Install → create app owner → add mailbox → discover settings → verify IMAP and SMTP → map special folders → first Inbox page → show sync freshness.
2. Receive → list update or visible reconnect state → open sanitized message → reply → draft saved → submit → acceptance and Sent filing shown separately.
3. Move/archive → instant reversible visual state → server operation → reconcile authoritative flags/folder → restore and explain on rejection.
4. Search across a selected account or all accounts → parse chips and text → show scope and partial-results warning if an account is offline.
5. Diagnose → choose account → run safe connection test → see user-level cause, optional stages, sanitized protocol evidence, and next action.
6. Recover → restart or network loss → cached list with last-sync timestamp → reconnect/reconcile → retain drafts and surface uncertain sends.

## 4. Problems with existing mail clients

These are design hypotheses to validate in usability sessions, not universal judgments. Setup frequently exposes protocol terminology too early; mailbox freshness can be ambiguous; sending and Sent filing are confused; errors may give a raw code without an action; desktop layouts can become cramped on phones; admin logging can disclose secrets. Conversely, hiding all protocol detail makes provider-specific failures hard to diagnose. Interview at least 6 everyday users and 4 developers/admins, test three realistic provider setups, and observe completion time, wrong-account sends, and recovery from failed SMTP. The product must earn its positioning through these tests.

## 5. Competitive analysis

| Product | Strength to study | Opportunity / boundary for this product |
| --- | --- | --- |
| Gmail | Conversation flow, search, undo-send delay and optional offline use | Provider-specific ecosystem; reproduce useful interactions with IMAP-aware semantics, not Gmail assumptions. [1] |
| Outlook web | Folder operations, reading experience, search and display density | Study information hierarchy; keep diagnostic tools nearer to the account without crowding mail. [2] |
| Thunderbird | Mature multi-account configuration, unified folders and protocol breadth | Study account controls and folder mapping; web app needs its own mobile and deployment approach. [3] |
| Roundcube | Established open-source IMAP webmail, extensibility and deployability | Better progressive disclosure, account health and guided troubleshooting. [4] |
| SnappyMail | Lightweight responsive webmail and admin configuration | Compete on reliable sync, durable drafts and observable send pipeline rather than merely visual speed. [5] |
| Mailpile | Privacy-first local ownership and search | Preserve self-hosted privacy; do not require client-side crypto or full-content indexing in V1. [6] |
| mailcow web UI / SOGo | Integrated mail-stack administration and webmail | Remain mail-server-agnostic; do not duplicate hosting, DNS and queue administration. [7] |
| Mailpit | Excellent captured-message inspection and SMTP failure simulation | Borrow readable diagnostics and testing ideas; it is a development SMTP catcher, not a daily IMAP client. [8] |

## 6. UX principles

Progressive disclosure; accurate state labels; reversible actions where safe; identity always visible during compose; keyboard and touch as first-class inputs; accessibility by default. Distinguish **connected**, **last synchronized**, **SMTP connection test passed**, **SMTP accepted**, **Sent copy filed**, and **delivery unknown**. Density is configurable without concealing required information. Every error offers recovery and says whether the draft is safe.

## 7. Information architecture

Top level: Mail, Search, Activity & Health, Settings. Mail contains unified Inbox and account-specific folder trees; each folder view remembers account, sort, density, and cursor. Activity & Health contains SMTP activity, sync/IMAP activity, diagnostics, account health. Settings contains accounts, identities, folder mappings, display/shortcuts, privacy, security and instance administration (role gated). Composer is global, with an explicit From identity.

## 8. Desktop UX

Three-pane layout: resizable account/folder rail (220–300 px), virtualized message list (320–480 px), flexible reading pane; collapse reading pane at medium width. Stable toolbar holds compose, search, scope, refresh and status. List row displays sender, subject, excerpt, date, attachments, unread/star, account marker in unified views. Selection does not silently mark read until content is actually presented; timing is configurable. Multi-select actions show undo where the server mutation permits. Composer can float/minimize, with a clear persistent saved state.

## 9. Mobile UX

A route stack: accounts/folders → message list → message; browser Back mirrors UI Back. Search and compose are reachable from the list; actions live in a compact bottom bar on messages. Swipe actions are optional, discoverable and reversible; no destructive swipe as the only control. Attachments stream/download explicitly. A full-screen composer restores scroll and focus when closed. Test 320 px through tablet widths, zoom to 200%, safe-area insets and virtual keyboard behavior.

## 10. Application screens

Each row is a wireframe-level content order. Shared loading rule: keep the shell and cached content, show small inline progress; shared error rule: human cause, recovery action, expandable detail; shared keyboard rule: visible focus, Escape closes overlays, shortcuts do not fire inside inputs.

| Screen | Hierarchy, navigation and actions | Empty / failure behavior |
| --- | --- | --- |
| Login | Brand → username/password → sign in; registration only during owner bootstrap or if admin enables it | Rate-limit error without account enumeration; recovery path configured by admin |
| First-run | Welcome → create owner → deployment security check → add mailbox → success checklist | Resume interrupted setup; avoid claiming SMTP works before a meaningful test |
| Add account | Email + credential/OAuth choice → discovery stages → detected hosts → optional manual form → test/map folders | Stage-specific failure with edit/retry; TLS warning never silently bypassed |
| Inbox / folder | Rail → toolbar/status → message rows → selected viewer; list navigation/filters | “No mail here”; stale cache has timestamp and retry |
| Conversation | Subject → ordered message cards → recipient/identity → body → attachments → reply actions | Broken thread shows individual messages; unsafe remote content blocked |
| Composer | From → To/Cc/Bcc → subject → editor → attachment strip → saved/queued/sending status → Send | Autosave errors persist visibly; close offers keep draft/discard |
| Search | Query → scope → chips → results with account/folder → message viewer | Unsupported token explained; partial offline results flagged |
| Settings | Sidebar categories → focused form with saved state and contextual help | Changed settings validate before commit; risky changes explain effects |
| Accounts | Account rows with health → account detail/credentials/folder map/identities | No accounts: add action; auth expiry: reconnect action |
| SMTP activity | Time/status/to/subject summary → event detail with stages and redacted transcript | No activity: explain it records sends through this app only |
| IMAP activity | Account timeline → sync attempts, folder checkpoints and reconnect causes | Never imply visibility into other clients' SMTP activity |
| Account health | Overview → IMAP/SMTP capability, last successful sync, folder mapping, action | Unknown status explicit; “test send” requires a chosen recipient and confirmation |
| Diagnostics | Tool selector → staged run → duration and certificate/capability summary → sanitized details/export | Network/policy failures identify stage; no automatic send to arbitrary recipients |
| Mobile equivalents | Folder drawer/list/message full-screen; composer full-screen; Activity/Settings stacked sections | Same content and controls, no hidden-only hover actions |

## 11. Component hierarchy

`AppShell` owns navigation, status and responsive regions; `MailboxWorkspace` contains `FolderTree`, `MessageList` with row virtualization, `MessageViewer` and `ActionFeedback`; `ComposerManager` owns multiple `ComposerWindow` instances and draft state; `SearchWorkspace` owns parser chips and result list; `HealthWorkspace` owns account cards and diagnostic timelines. Shared primitives: account badge, address input, status label, accessible disclosure, error panel, attachment row, confirmation dialog, toast with undo. Pinia stores UI state and server projections; server state is versioned and invalidated by events rather than trusted as authority.

## 12. Backend architecture

Fastify API handles authentication, authorization, validation, content policy and REST endpoints. Separate worker process handles IMAP sync, SMTP submission and attachment cleanup through BullMQ; a per-account coordinator owns ordered mailbox mutations and sync leases. PostgreSQL holds indexed projections and durable workflow records; Redis holds queues, short-lived locks and fan-out, never the only copy of a draft or send intent. Adapter interfaces isolate ImapFlow and Nodemailer for protocol tests and future provider quirks. Prefer a modular monolith over microservices: fewer failure domains and simpler Compose operations. Tradeoff: workers and API still require separate scaling and careful version compatibility.

## 13. IMAP architecture

Identify message instance by `(account_id, mailbox_id, uidvalidity, uid)`, never UID alone. Mailbox identity uses provider path plus namespace/delimiter and role mapping; handle renamed/deleted folders explicitly. Record UIDNEXT, HIGHESTMODSEQ when supported, capabilities and last full reconciliation. Use LIST/SPECIAL-USE and user override for roles; do not infer Sent solely from an English folder name. Prefer QRESYNC/CONDSTORE where actually supported and library support verified; otherwise UID-based incremental fetch plus periodic flag and deletion reconciliation. IDLE is a hint, not a durability guarantee. Respect provider connection limits with bounded per-account concurrency; isolate mailboxes to avoid holding a lock across unrelated operations. IMAP APPEND, MOVE/COPY and STORE responses are reconciled against server state. Consult RFC 9051 and RFC 7162 for semantics. [9]

## 14. SMTP architecture

A durable send intent references immutable MIME bytes, account, envelope recipients, identity, draft revision, idempotency key and status. Build MIME once, assign Message-ID once. State machine: `prepared → connecting → submitting → accepted/partial/definitely_rejected/uncertain → sent_filing_pending → filed/filing_failed`. Persist the final SMTP response and per-recipient acceptance. Nodemailer `verify` checks connectivity/authentication but does not prove that a sender/recipient will be accepted; normal transport telemetry may not expose every command boundary, so a separately instrumented connection is required for detailed stage probes. Never imply end-to-end delivery from SMTP acceptance. Partial recipient acceptance gets a distinct UI and must not silently resend accepted recipients. [10]

For Sent: probe observed provider behavior using a unique Message-ID and bounded search of the mapped Sent folder; configuration records auto-filing policy only after evidence, with user override. If not found after an appropriate bounded wait, APPEND exact MIME bytes with `\\Seen`, then reconcile; on timeout/ambiguous APPEND, search by Message-ID and MIME fingerprint before retrying. The UI may show “Accepted; saving to Sent” or “Accepted; Sent copy needs attention.” A failed Sent APPEND never triggers a second SMTP send.

## 15. Synchronization algorithm

1. Acquire short lease for account/folder; connect, authenticate, discover LIST and capabilities; reconcile folder roles and vanished folders.
2. SELECT/EXAMINE folder, compare UIDVALIDITY. On change, invalidate prior UID projections for that folder, retain old rows only for repair/audit if required, and rebuild paged; do not reuse old UIDs.
3. Initial page: fetch newest bounded UID window, envelope, flags, size, INTERNALDATE, Message-ID/References and bodystructure; commit rows and checkpoint atomically. Continue older metadata pages at controlled priority, with visible coverage range.
4. Incremental path: QRESYNC changed/vanished when safe; otherwise fetch UIDs beyond checkpoint, reconcile flags in bounded windows and deletions with periodic UID inventory. Handle UIDNEXT gaps and unsolicited EXPUNGE.
5. Commit changes in DB before emitting versioned events. Ack jobs only after commit. Enter IDLE on eligible watched folder(s), renew it and poll low-priority folders; reconnect with bounded exponential backoff and jitter.
6. On outage/restart: re-open and compare UIDVALIDITY/MODSEQ, replay pending mutations using operation IDs and server verification, refresh counters, and repair mismatches. Avoid claiming a complete history until backfill finishes.

Tradeoff: fast initial inbox versus complete cross-folder search; disclose coverage. No unbounded full-body download. Rate limits and malformed messages must not poison an entire folder.

## 16. Database design

PostgreSQL is authoritative for app users, sessions, settings, encrypted credential envelopes, draft revisions, outbound intents, activity and sync metadata; IMAP is authoritative for mailbox messages/folders/flags. Tables use UUID app IDs, tenant/user ownership, timestamps and row-version fields. Keep metadata retention configurable and delete it when an account is removed. Store message body only as an encrypted, size-bounded, expiring cache if needed for performance; V1 can fetch on open. Never store attachment bytes in PostgreSQL. Index on account/mailbox/UID, folder/date, thread IDs and send status.

## 17. Queue/background job design

Queues: `discover`, `sync-inbox`, `sync-folder`, `mail-mutate`, `submit`, `file-sent`, `draft-append`, `maintenance`. Persist intent first in PostgreSQL, enqueue with stable job ID, reconcile a DB outbox after crashes. Retries only for idempotent reads and provably safe writes; SMTP submission after ambiguous acceptance becomes `uncertain` and requires server/user reconciliation. Leases prevent concurrent folder writers, but a lease is not correctness by itself. Dead-letter failures have operator-visible reason and repair action. BullMQ/Redis improves scheduling; DB state preserves correctness during Redis loss.

## 18. Realtime architecture

Use SSE for V1 server→browser notifications because browser actions already use HTTP and reconnection is simple. Authenticate same-origin stream, scope by user/account, send monotonic per-user sequence IDs and event versions. On reconnect, resume from retained event log when available; otherwise send `resync_required` and fetch fresh snapshots. Events carry IDs and summary state, never raw body or credentials. Alternative WebSocket is appropriate if future presence or bidirectional collaboration needs it; it adds connection management now without benefit.

## 19. Security architecture

Threat model: malicious mail content, malicious attachments and links, stolen session, malicious account configuration (SSRF), cross-user data access, leaked secrets/logs, compromised host/backup. HTTPS and secure HTTP-only SameSite cookies; CSRF token for unsafe methods; Argon2id for app passwords; MFA/admin hardening before internet-facing multi-user release; per-user/account authorization on every resource; CSP; rate limits and login lockout/backoff; security headers; audit of credential and admin actions. Validate hosts and resolved addresses before each outbound connection and redirect/re-resolution, with network policy to block loopback, link-local and metadata/private ranges unless an admin explicitly permits a known on-prem mail server. No TLS-validation bypass in normal setup. Encryption at rest does not protect against a compromised running app host. Follow OWASP HTML sanitization guidance. [11]

## 20. Credential management

Envelope-encrypt mailbox passwords and OAuth refresh tokens using AES-256-GCM with random nonce, AAD binding account/credential version, and a 256-bit master key outside PostgreSQL; document rotation and backup/restore of that key. Use secret file or Docker secret in reference deployment, with KMS interface later. Keep decrypted material in memory only during use, never return via API or logs. OAuth authorization code + PKCE, encrypted refresh token, least scopes and explicit reauthorization state. App login registration is owner bootstrap and admin-controlled thereafter; password reset cannot rely on an unconfigured mail transport. Deleting an account removes tokens, cached metadata and queued jobs with retention policy.

## 21. HTML email security

Parse MIME server-side with bounded recursion, parts and sizes. Sanitize HTML with a maintained allowlist, strip scripts/forms/event handlers, dangerous URL schemes, CSS fetches and active content; render sanitized output inside a sandboxed separate-origin iframe with restrictive CSP, no same-origin privilege, and explicit safe bridge for link actions. Block external resources by default, proxy remote images only after consent with SSRF defenses, no cookies and privacy-aware caching. Open links with safe scheme validation, `noopener noreferrer`, and a visible destination on suspicious mismatches. HTML sanitizer + iframe + CSP are defense in depth; test parser differentials and malformed MIME. Plain text is escaped and linkified safely. Attachment download is streamed with content-disposition, sniffed type limits and optional antivirus hook; no inline active HTML/SVG. [11]

## 22. Search architecture

Tokenize a documented grammar (`from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `is:starred`, `before:`, `after:`) with quoted strings, escapes, AND, explicit scope; invalid tokens show helpful correction. IMAP SEARCH runs per folder/account with bounded concurrency; join and rank projected metadata in PostgreSQL. Important tradeoff: IMAP search support, tokenization and server text matching vary, and a local metadata cache may cover only a recent window. UI displays search scope and completeness; no claim of instant complete cross-account full-text search in V1. Search bodies server-side through IMAP when requested, rate-limited; PostgreSQL metadata index speeds common filters. Later opt-in encrypted-at-rest full-text indexing with clear privacy and disk costs.

## 23. Threading algorithm

Parse Message-ID, In-Reply-To and References per RFC 5322; normalize valid IDs, retain duplicate-ID message instances, link references within account, detect cycles and cap depth. A missing or duplicated ID prevents confident merge; conservative subject + participants + bounded time may suggest a thread, but require user-visible separation when ambiguous. For unified views, cross-account merges are display-only and never change account ownership. Forwarded messages are not presumed replies. Stable thread key is an app projection that can be rebuilt, and migrations need a version. Test Outlook/Gmail quirks and malformed headers. [12]

## 24. Draft architecture

Each composer has a UUID and monotonically increasing revision. Debounced autosave writes durable server draft data and attachment references, returns revision acknowledgment, and reflects unsaved/saving/saved/error states. Local IndexedDB stores an encrypted-at-rest-by-browser limitation: browser storage itself is not secure against local users/XSS; use it only for short-lived emergency recovery, configurable or disabled on shared devices, purge on logout. Server draft is primary for app recovery. Sync to IMAP Drafts with serialized APPEND of the MIME draft and cleanup of prior UID after new APPEND confirmation; reconcile ambiguous outcomes by draft UUID header. Concurrent tabs use revision conflict resolution, never last-write-wins silently. Closing one of multiple composers does not erase others. Sending freezes an immutable revision; draft deletion follows accepted send and Sent filing policy, with retained recovery copy during uncertain state.

## 25. Attachment architecture

Upload into quota-bound encrypted-at-rest temporary object storage/volume with UUID references, stream hashing and content sniffing; sanitize filenames, scan when configured, reject oversize and decompression bombs. MIME assembly streams attachments without buffering entire file. Downloads use authenticated, ownership-checked short-lived routes and safe headers; external images are separate. Enforce per-file/total draft size and provider-specific SMTP limits (encoded MIME expansion included). Clean orphaned temp uploads only after grace period and draft-reference check. Back up persistent draft attachments; downloaded mail attachments can be fetched again from IMAP.

## 26. Offline/reconnection strategy

Show last successful sync, per-account freshness and offline banner. Retain bounded, privacy-configurable metadata in browser for recently seen lists; opened bodies only if user enables offline cache, with shared-device warning. Server drafts remain available when server is reachable even if provider is offline; browser-local recovery captures unsaved edits during app disconnect. Queue safe, identified mailbox mutations with precondition/reconcile on reconnect; never auto-queue SMTP sends offline in V1. On a timed-out SMTP attempt, show **status uncertain** and prevent one-click resend until checked. Exponential backoff with jitter, network visibility hints and manual retry respecting limits.

## 27. Error handling strategy

Error taxonomy: DNS, TCP timeout, TLS name/chain, credentials, OAuth expiry, permission, folder missing, provider limit, conflict, malformed MIME, attachment limit, SMTP per-recipient rejection, SMTP uncertain, Sent filing failure, storage/queue failure. API errors have stable code, correlation ID, safe summary, retryable flag and optional sanitized detail. UI says what happened, whether the draft/message is safe, the next action, and why retry may duplicate. Example: “Accepted by the outgoing server. We could not confirm a copy in Sent. Do not send it again; retry saving the copy.” No raw secrets or stack traces to ordinary users.

## 28. Diagnostics architecture

Two modes: connection-only health test, and explicit test message. DNS/TCP/TLS/auth/IMAP CAPABILITY/NAMESPACE/LIST/SELECT and SMTP EHLO/AUTH stages have timestamps, outcome and safe metadata. RCPT and DATA are **not** part of a harmless connection test: they require sender, recipient and a clear send confirmation. Probe code uses real protocol behavior with opt-in test destination; synthetic probes must be labeled. TLS panel shows hostname, peer chain summary, expiry and negotiated version without exposing secrets. On-demand sanitized transcript is allowlisted at capture time, never raw protocol AUTH buffers. Retention is configurable. SMTP activity includes only sends performed by this app; external OVH/application sends require provider logs or an explicitly connected relay, beyond V1 scope.

## 29. Logging/observability

Structured logs with request, account, folder sync, queue job and send-intent IDs; never message body, addresses by default, OAuth tokens, credentials, AUTH challenges or full raw SMTP transcript. Diagnostic activity may show recipient/subject only to the account owner under a configurable retention period; operator metrics aggregate without content. Track connection count, sync lag, cache coverage, UIDVALIDITY resets, SMTP acceptance/rejection/uncertain, Sent filing failure, queue depth, draft save age and API latency. Health endpoints distinguish liveness from dependency readiness. Export sanitized support bundle with preview and explicit consent.

## 30. Testing strategy

Unit: parser, threading, role mapping, state machines, redaction, sanitizer. Integration: Fastify/Postgres/Redis, real IMAP against Dovecot or GreenMail, SMTP against Postfix/Mailpit chaos. E2E: owner setup, account add, keyboard/mobile read, draft recovery, partial SMTP acceptance, Sent filing, auth expiry and reconnect. Contract/provider matrix: OVH, Gmail OAuth, Microsoft OAuth, generic Dovecot/Postfix on test accounts; record host settings, capabilities, folder roles, auto-Sent behavior and throttling. CI runs deterministic local protocols; provider tests run in a controlled scheduled/manual lane using disposable accounts. Fault injection: network cuts at SMTP DATA response and IMAP APPEND response, UIDVALIDITY reset, lost IDLE, stale flags, duplicate Message-ID, huge/malformed MIME, expiring TLS, Redis/worker restart, tenant isolation and XSS payloads. Do not use Mailpit as proof of IMAP behavior.

## 31. Performance strategy

Initial targets on reference hardware and seeded 10/10k/100k mailboxes: cached Inbox first meaningful list p95 <1.5 s; warm message open p95 <1 s; uncached body p95 <3 s when provider responds within 2 s; archive UI feedback <100 ms; durable draft acknowledgment p95 <500 ms on local network; sync lag p95 <15 s on healthy IDLE-supported Inbox, otherwise declared polling interval; browser list scroll 60 fps on representative laptop. These are provisional, measurable budgets, not guarantees across providers. Bound worker memory, concurrent IMAP connections, fetch batch size, MIME depth and attachment size; virtualize lists, paginate metadata, fetch bodies lazily, stream files. Load tests include concurrent accounts and provider rate-limiting; report hardware and percentile method.

## 32. Accessibility strategy

Target WCAG 2.2 AA; test manual keyboard and screen reader paths on every major screen at each phase. Semantic landmarks; roving focus in lists with announced sender/subject/unread; predictable focus after move/delete, modal close and route Back; visible focus and skip links; labels and error association on address chips; status announcements for save/send without excessive chatter; color-independent health states; reduced motion; zoom and reflow. Shortcuts are off while typing and configurable, with an accessible help dialog. Automate axe-style checks, then test NVDA/Chrome and VoiceOver/Safari in release gates.

## 33. Docker/deployment architecture

Reference Compose: Caddy, Nuxt frontend (static or server rendering per final implementation), Fastify API, worker, PostgreSQL, Redis, encrypted draft-attachment volume, secrets mounted outside DB. One documented install path (`cp .env.example .env`, generate secret, configure domain, `docker compose up -d`); “easy” does not mean insecure defaults. No exposed DB/Redis ports; rootless/non-root containers where possible; pinned image versions; health checks, graceful migrations and worker shutdown. Backup PostgreSQL plus attachment volume, encryption key and config consistently; restore drill verifies login, account sync and draft recovery. Document reverse proxy examples, upgrade/rollback compatibility and mail provider outbound ports. Redis loss must not erase user data.

## 34. Repository structure

`apps/web` Nuxt; `apps/api` Fastify; `apps/worker` jobs/protocol adapters; `packages/contracts` typed API/event schemas; `packages/mail-core` MIME/search/threading/state machines; `packages/ui` design system; `infra/compose`, `infra/migrations`; `tests/protocol`, `tests/e2e`, `docs/decisions`, `docs/ops`. Monorepo gives shared types and atomic migrations. Keep protocol packages independent of UI so tests can simulate providers. Avoid introducing extra deployable services for every module.

## 35. API design

JSON REST under `/api/v1`, cursor pagination, schema validation, ownership checks, conditional writes (`If-Match`/revision) and idempotency keys for mutations. Principal routes: `POST /auth/bootstrap|login|logout`, `GET /me`; `GET/POST /accounts`, `POST /accounts/discover|test`, `PATCH /accounts/:id`, `GET /accounts/:id/health`; `GET /folders`, `GET /messages?account&folder&cursor`, `GET /messages/:id`, `POST /messages/:id/actions`; `GET/POST/PATCH /drafts`, `POST /drafts/:id/attachments`, `POST /drafts/:id/send`; `GET /sends/:id`, `POST /sends/:id/reconcile-sent`; `GET /search`; `GET /activity/smtp|imap`; `POST /diagnostics/:accountId/imap|smtp-connection|smtp-send-test`; `GET /events`. Response has `data`, `version`, `coverage`, `nextCursor` where relevant; errors have `code`, `message`, `retryable`, `requestId`. No arbitrary unauthenticated host/port probes.

## 36. WebSocket/SSE events

SSE event envelope: `id` sequence, `type`, `accountId`, `entityId`, `version`, `occurredAt`, `payload` limited to safe summary. Types: `account.health.changed`, `folder.changed`, `message.upserted`, `message.removed`, `sync.progress`, `sync.stale`, `draft.saved`, `send.status.changed`, `diagnostic.completed`, `resync_required`. Order guaranteed per user stream, not globally; duplicate delivery is expected. Client compares versions, ignores old events and refetches after gaps. Keep the API response as the authoritative app projection and IMAP as mailbox authority.

## 37. Database schema

| Table | Key fields / constraints | Purpose |
| --- | --- | --- |
| `users`, `sessions`, `audit_events` | user UUID; password hash; session hash/expiry; actor/action | App auth and audit |
| `accounts`, `credentials` | owner FK; provider/settings; encrypted blob, nonce, key version | Mail connection and secrets |
| `identities`, `folder_mappings` | account FK; address verified/configured; role→folder | Send identity and special folders |
| `mailboxes`, `sync_checkpoints` | unique `(account,path)`; UIDVALIDITY, UIDNEXT, MODSEQ, coverage, last success | Folder projection and recovery |
| `messages` | unique `(account,mailbox,uidvalidity,uid)`; envelope, flags, dates, size, bodystructure, header IDs | Rebuildable metadata |
| `thread_nodes`, `threads` | message FK; parent link; algorithm version | Rebuildable grouping |
| `drafts`, `draft_revisions`, `attachment_refs` | owner, composer UUID, revision, encrypted content/ref, lifecycle | Durable editing and recovery |
| `send_intents`, `smtp_recipients`, `sent_filings` | idempotency key; immutable MIME ref/hash; per-recipient result; APPEND state | No blind resend, Sent copy tracking |
| `mail_mutations`, `job_outbox` | stable operation IDs, precondition, result | Reconciliation and durable enqueue |
| `activity_events`, `diagnostic_runs`, `user_events` | scoped owner, expiry, redacted stage data, sequence | Troubleshooting and SSE replay |

Indexes and migrations: compound folder/date cursor; account/status; owner/event sequence; references lookup scoped by account; partial indexes for pending work. Partition or expire high-volume activity after measuring growth. Foreign keys cascade or explicitly purge according to retention. Draft attachment references use transaction-safe lifecycle, not cascade-delete before cleanup.

## 38. Development phases

Every phase produces a usable vertical slice or testable infrastructure and has a demo, migration/rollback notes and security/accessibility review. `—` means no schema change; “tests” name the risk being verified.

| Phase / dependency | Goal and implementation (backend; frontend; DB) | Tests and edge cases | Exit criteria |
| --- | --- | --- | --- |
| 0 / none | Research, provider matrix, threat model, IA, screen flows, design tokens; no code; DB — | Interview/setup prototypes including OVH Sent case | Decisions and high-risk experiments reviewed |
| 1 / 0 | Foundation: monorepo, API/web/worker, Compose, migrations, CI, structured logs; shell/design system; users schema starter | Health and restart; broken env, persistent volume | Fresh Compose boot, migrations repeat safely |
| 2 / 1 | Owner auth, sessions, account discovery/test, encrypted secrets and OAuth adapter; setup screens; users/accounts/credentials | SSRF, invalid TLS, OAuth expiry, wrong password | Generic IMAP + SMTP setup and secure persistence |
| 3 / 2 | IMAP connector, folder role mapping, paged metadata sync/checkpoints; folder skeleton and status; mailboxes/messages/checkpoints | UIDVALIDITY, restart, namespaces, large folder | Bounded initial Inbox, accurate counters after reconciliation |
| 4 / 3 | List actions, reconciliation and virtual list; three-pane UI; mutations/outbox | MOVE unsupported, concurrent external changes, undo failure | Read/star/move/archive/trash match IMAP |
| 5 / 3 | MIME parsing, safe rendering, streamed attachments; viewer; optional cache metadata | XSS, remote pixels, broken MIME, large files | Dangerous content isolated; text and HTML readable |
| 6 / 2,5 | Immutable MIME/send intent, SMTP tracking, Sent filing; compose UI; send tables | Partial rejection, uncertain DATA, APPEND timeout, auto-Sent | No silent duplicate send or Sent copy |
| 7 / 5,6 | Revisioned autosave, IMAP Drafts mapping, temp attachments; multi-composer UI; drafts/revisions/refs | Refresh, concurrent tabs, lost network, crash | Unsaved state visible; durable draft recovery |
| 8 / 3,5,6 | Header-reference threading; conversation UI; thread tables | Duplicate/missing IDs, cycles, forwards | Conservative stable grouping and reply headers |
| 9 / 3,8 | Query grammar, bounded IMAP search and metadata index; search UI; indexes | Partial coverage, server differences, malformed token | Scope/completeness stated; filters correct |
| 10 / 3,4,7 | IDLE coordinator, SSE replay, reconnect repair; live status UI; event log | Missed IDLE, restart, stale sequence, Redis loss | State converges and stale badge resolves |
| 11 / 2,3,6 | Safe staged probes, activity retention; health/diagnostics UI; diagnostic/activity tables | AUTH redaction, harmless versus send test | Causes/timings actionable, no secrets |
| 12 / 8–11 | Unified inbox, per-account identities and scope; account badges; projection indexes | Overlapping Message-ID across accounts, wrong From | Unified triage without identity confusion |
| 13 / 4–12 | Responsive routes, gestures, composer, attachment UX; schema — | 320 px, touch, back stack, keyboard | Core mobile journeys complete without overflow |
| 14 / 4–13 | Focus, announcements, shortcut configurability; preferences | NVDA/VoiceOver, zoom, reduced motion | WCAG 2.2 AA audit defects resolved |
| 15 / 3–14 | Profile, batch sizing, virtualization and limits; indexes if measured | 100k seeds, simultaneous accounts, throttling | Published p95 budgets or documented remediation |
| 16 / 2–15 | Threat model review, pentest, hardening, key rotation; security settings | XSS/SSRF/CSRF/tenant isolation, restore key | Critical/high findings closed |
| 17 / 3–16 | Multi-provider and chaos campaigns, recovery playbooks; schema only if needed | OVH/Gmail/Microsoft/generic, outage at send/APPEND | No lost drafts or duplicate sends in fault suite |
| 18 / 1–17 | Versioned Compose release, backups/restores/upgrades, docs and onboarding; migrations finalized | Fresh install, upgrade, rollback, restore drill | Install and recovery guides verified by another operator |

Suggested delivery gates: after phase 3, read-only alpha; after phase 7, single-account daily-use beta; after phase 12, feature-complete beta; after phase 18, production release. Phase 6 and 7 are a single release gate for real sending: do not encourage daily use until durable drafts and uncertain-send handling are in place.

## 39. MVP definition

Release scope: owner/app authentication; secure multi-account setup with auto/manual discovery; generic IMAP/SMTP and validated OAuth providers; mapped folders; metadata sync with recovery; read/unread/star/move/archive/trash; safe viewer/attachments; compose/reply/reply-all/forward; durable drafts; conservative threads; scoped search with completeness indicator; SSE freshness; per-account health and opt-in diagnostics; activity for sends through this app; mobile, theme/density, accessibility and Compose deployment. Completion means every promised provider in the compatibility matrix passes its named send, Sent, receive and recovery cases. Stronger than a demo, narrower than “perfect on all servers.”

## 40. Post-MVP roadmap

Order by demand and measured need: scheduled send/undo-send delay; rules and snooze; contacts, signatures/templates/aliases; optional full-text index; richer offline cache; delegated/team mailbox; DKIM/SPF/DMARC diagnostic views; optional mail-server integrations; PGP/S/MIME; calendar; opt-in AI with explicit privacy boundary. No automatic outbox retry is introduced without a protocol-safe design and user-facing uncertainty model.

## 41. Risks and difficult technical areas

| Risk | Mitigation / decision gate |
| --- | --- |
| Ambiguous SMTP acceptance and partial recipients | Durable immutable intent, per-recipient states, no blind retry, manual reconciliation |
| Sent auto-filing varies by provider | Detect and test; separate SMTP and IMAP APPEND; dedupe by Message-ID plus fingerprint |
| IMAP deletion/flag drift without QRESYNC | Periodic bounded reconciliation and accuracy tests |
| OAuth provider policy and permissions | Early disposable-provider prototypes; explicitly scope supported account types |
| Untrusted HTML and SSRF | Separate origin, sanitizer, CSP, network restrictions, fuzz and review |
| Data cache privacy and key loss | Retention, encrypted secrets, backup key and restore drills |
| Full-text completeness and cross-provider speed | Surface scope/coverage, measure before adding search service |
| Resource cost of many accounts/IDLE connections | Bounded concurrency, priority folders and polling fallback |
| Large MVP and phase coupling | Gate daily sending on drafts/recovery, publish supported-provider matrix |

## 42. Acceptance criteria

- Setup: on tested providers a user reaches a populated Inbox with correct folders; invalid credentials/TLS receive correct cause and action; manual path handles unusual hosts securely.
- Correctness: after externally mutating flags/moves/deletions and restarting workers, displayed state converges with IMAP; UIDVALIDITY resets never mix identities; no duplicate Sent copies in fault tests.
- Send: each recipient has accepted/rejected/uncertain state; an accepted submission never triggers automatic second submission because Sent APPEND failed; UI never claims delivery.
- Drafts: refresh, offline interruption, competing tabs and worker restart preserve acknowledged revisions and expose conflicts.
- Security: no credentials, OAuth tokens or AUTH material in logs/diagnostics; hostile HTML cannot execute in app origin; SSRF and cross-user access tests pass.
- UX: wrong-account sending is caught by visible From identity; status shows freshness; mobile core flows and keyboard/screen-reader tasks pass; failures have a next step.
- Operations: fresh install, upgrade, backup and restore are performed on the release candidate; dependency failures show in health and don't erase durable state.
- Performance: publish measured percentiles for agreed hardware/mailbox sizes and meet provisional budgets or revise them with evidence before release.

## 43. Definition of done

A feature is done when its server behavior is correct under retry/restart, its UI explains pending/error/success states, tenant/security boundaries are tested, keyboard/mobile/screen-reader paths work, metrics and sanitized logs identify failures, documentation and migration/recovery steps exist, and its phase acceptance test passes. V1 is done after an independent review of the full provider matrix and recovery drill, open critical/high security issues are resolved, no known draft-loss or duplicate-send path remains, and scope/limitations are plainly documented. Approval of this plan is the gate before implementation code.

## Research sources

1. Gmail Help: [send or unsend](https://support.google.com/mail/answer/2819488?hl=en), [offline mail](https://support.google.com/mail/answer/1306849?hl=en).
2. Microsoft Support: [organize mail](https://support.microsoft.com/en-us/outlook/organize-your-inbox-with-archive-sweep-and-other-tools-in-outlook-on-the-web), [search](https://support.microsoft.com/en-us/outlook/search-mail-and-people-in-outlook-on-the-web), [density](https://support.microsoft.com/en-us/outlook/change-the-look-of-your-mailbox-in-outlook-com-and-outlook-on-the-web).
3. Thunderbird Support: [account options](https://support.mozilla.org/en-US/kb/configuration-options-accounts), [unified folders discussion](https://support.mozilla.org/en-US/questions/1479993).
4. Roundcube: [about](https://roundcube.net/about/), [plugins](https://plugins.roundcube.net/).
5. SnappyMail: [project](https://snappymail.eu/), [documentation](https://snappymail.eu/documentation).
6. Mailpile: [project](https://www.mailpile.is/).
7. mailcow: [documentation](https://docs.mailcow.email/).
8. Mailpit: [features](https://mailpit.axllent.org/docs/), [SMTP chaos and integration](https://mailpit.axllent.org/docs/integration/).
9. [RFC 9051 IMAP4rev2](https://www.rfc-editor.org/rfc/rfc9051), [RFC 7162 CONDSTORE/QRESYNC](https://www.rfc-editor.org/rfc/rfc7162), [ImapFlow mailbox management](https://imapflow.com/docs/guides/mailbox-management/).
10. [Nodemailer SMTP transport](https://nodemailer.com/smtp), [SMTP connection](https://nodemailer.com/extras/smtp-connection), [error reference](https://nodemailer.com/errors), [RFC 8314 TLS](https://www.rfc-editor.org/rfc/rfc8314), [RFC 6186 discovery](https://www.rfc-editor.org/rfc/rfc6186).
11. [OWASP XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [DOM clobbering](https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html).
12. [RFC 5322 message identification fields](https://www.rfc-editor.org/rfc/rfc5322).
