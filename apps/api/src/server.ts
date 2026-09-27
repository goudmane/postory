import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { z } from 'zod'
import { pool, migrate } from './db.js'
import { assertKey, decrypt, encrypt, tokenHash } from './security.js'
import { fileSent, folders, MailboxChanged, message, messages, prepareMail, safeMailError, sendRaw, setFlag, testAccount, type Account } from './mail.js'

assertKey()
await migrate()
// A crashed worker/process may have received the SMTP success reply. Never retry these automatically.
await pool.query("UPDATE send_intents SET status='uncertain', detail='Interrupted while submitting; check before resending', updated_at=now() WHERE status='submitting'")

const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.credential'] }, bodyLimit: 1024 * 1024 })
await app.register(cookie)
await app.register(rateLimit, { global: false })
const origin = process.env.APP_ORIGIN || 'http://localhost:3000'
const cookieSecure = process.env.COOKIE_SECURE === 'true'

app.setErrorHandler((error, req, reply) => {
  // The error object can contain protocol or validation input; do not log it verbatim.
  req.log.error({ errorType: (error as Error).name, requestId: req.id }, 'request failed')
  const err = error as Error & { statusCode?: number }
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500
  reply.code(status).send({ code: status === 500 ? 'INTERNAL' : 'INVALID_REQUEST', message: status === 500 ? 'The request could not be completed' : err.message, requestId: req.id })
})
app.addHook('onRequest', async (req, reply) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin !== origin) {
    return reply.code(403).send({ code: 'ORIGIN_REQUIRED', message: 'Invalid request origin' })
  }
})

async function owner(req: { cookies: Record<string, string | undefined> }): Promise<string | null> {
  const token = req.cookies.mailroom_session
  if (!token) return null
  const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at > now()', [tokenHash(token)])
  return rows[0]?.user_id || null
}
async function requireUser(req: { cookies: Record<string, string | undefined> }, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  const id = await owner(req)
  if (!id) { reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Sign in to continue' }); return null }
  return id
}
async function account(id: string, userId: string): Promise<Account | null> {
  const { rows } = await pool.query('SELECT * FROM mail_accounts WHERE id=$1 AND user_id=$2', [id, userId])
  return rows[0] || null
}
function noAccount(reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(404).send({ code: 'NOT_FOUND', message: 'Account not found' })
}
function asId(value: unknown) { return z.string().uuid().parse(value) }

app.get('/health', async () => ({ ok: true }))
app.get('/api/v1/bootstrap-status', async () => {
  const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM app_users) AS has_owner')
  return { needsSetup: !rows[0].has_owner }
})
const authInput = z.object({ email: z.email(), password: z.string().min(12).max(1024) })
app.post('/api/v1/bootstrap', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const input = authInput.parse(req.body)
  const id = randomUUID()
  // A unique database lock prevents two concurrent bootstrap requests creating owners.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE app_users IN EXCLUSIVE MODE')
    if ((await client.query('SELECT 1 FROM app_users LIMIT 1')).rowCount) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ code: 'ALREADY_CONFIGURED', message: 'Owner account already exists' })
    }
    await client.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)', [id, input.email.toLowerCase(), await argon2.hash(input.password)])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  return createSession(id, reply)
})
async function createSession(userId: string, reply: { setCookie: (name: string, value: string, options: object) => unknown }) {
  const token = randomBytes(32).toString('base64url')
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [tokenHash(token), userId])
  reply.setCookie('mailroom_session', token, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/', maxAge: 7 * 86400 })
  return { id: userId }
}
app.post('/api/v1/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const input = authInput.parse(req.body)
  const { rows } = await pool.query('SELECT id,password_hash FROM app_users WHERE email=$1', [input.email.toLowerCase()])
  if (!rows[0] || !await argon2.verify(rows[0].password_hash, input.password))
    return reply.code(401).send({ code: 'BAD_CREDENTIALS', message: 'Email or password is incorrect' })
  return createSession(rows[0].id, reply)
})
app.post('/api/v1/logout', async (req, reply) => {
  if (req.cookies.mailroom_session) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(req.cookies.mailroom_session)])
  reply.clearCookie('mailroom_session', { path: '/' })
  return { ok: true }
})
app.get('/api/v1/me', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const { rows } = await pool.query('SELECT id,email FROM app_users WHERE id=$1', [user])
  return rows[0]
})

const accountInput = z.object({ email: z.email(), label: z.string().trim().min(1).max(80),
  imapHost: z.string().min(1).max(253), imapPort: z.number().int().min(1).max(65535), imapSecure: z.boolean(),
  smtpHost: z.string().min(1).max(253), smtpPort: z.number().int().min(1).max(65535), smtpSecure: z.boolean(),
  username: z.string().min(1).max(320), password: z.string().min(1).max(1024) })
app.get('/api/v1/accounts', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const { rows } = await pool.query('SELECT id,email,label,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,sent_path FROM mail_accounts WHERE user_id=$1 ORDER BY created_at', [user])
  return rows
})
app.post('/api/v1/accounts', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const v = accountInput.parse(req.body)
  if (!v.imapSecure && v.imapPort !== 143 || !v.smtpSecure && v.smtpPort !== 587) return reply.code(400).send({ code: 'TLS_REQUIRED', message: 'Use TLS on 993/465 or STARTTLS on 143/587' })
  const id = randomUUID()
  const probe: Account = { id, user_id: user, email: v.email, label: v.label, imap_host: v.imapHost, imap_port: v.imapPort, imap_secure: v.imapSecure,
    smtp_host: v.smtpHost, smtp_port: v.smtpPort, smtp_secure: v.smtpSecure, username: v.username, credential: encrypt(v.password, id), sent_path: null }
  const result = await testAccount(probe)
  if (result.stages.some(s => !s.ok)) return reply.code(422).send({ code: 'MAIL_CONNECTION_FAILED', message: 'Could not connect to both incoming and outgoing mail', stages: result.stages })
  await pool.query(`INSERT INTO mail_accounts(id,user_id,email,label,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,credential,sent_path)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id,user,v.email,v.label,v.imapHost,v.imapPort,v.imapSecure,v.smtpHost,v.smtpPort,v.smtpSecure,v.username,probe.credential,result.sentPath])
  return reply.code(201).send({ id, email: v.email, label: v.label, sentPath: result.sentPath, stages: result.stages })
})
app.post('/api/v1/accounts/:id/test', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const a = await account(asId((req.params as { id: string }).id), user); if (!a) return noAccount(reply)
  return testAccount(a)
})
app.get('/api/v1/accounts/:id/folders', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const a = await account(asId((req.params as { id: string }).id), user); if (!a) return noAccount(reply)
  try { return await folders(a) } catch (error) { return reply.code(502).send({ code: 'IMAP_FAILED', message: safeMailError(error) }) }
})
app.get('/api/v1/accounts/:id/messages', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const a = await account(asId((req.params as { id: string }).id), user); if (!a) return noAccount(reply)
  const q = z.object({ path: z.string().min(1), page: z.coerce.number().int().min(0).max(10000).default(0) }).parse(req.query)
  try { return await messages(a, q.path, q.page) } catch (error) { return reply.code(502).send({ code: 'IMAP_FAILED', message: safeMailError(error) }) }
})
app.get('/api/v1/accounts/:id/messages/:uid', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const a = await account(asId((req.params as { id: string }).id), user); if (!a) return noAccount(reply)
  const { uid } = req.params as { uid: string }
  const { path, uidValidity } = z.object({ path: z.string().min(1), uidValidity: z.string().min(1) }).parse(req.query)
  try { const data = await message(a, path, z.coerce.number().int().positive().parse(uid), uidValidity); return data || reply.code(404).send({ code: 'NOT_FOUND', message: 'Message no longer exists' }) }
  catch (error) { if (error instanceof MailboxChanged) return reply.code(409).send({ code: 'MAILBOX_CHANGED', message: 'This folder changed on the server. Refresh it before opening the message.' }); return reply.code(502).send({ code: 'IMAP_FAILED', message: safeMailError(error) }) }
})
app.post('/api/v1/accounts/:id/messages/:uid/flag', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const a = await account(asId((req.params as { id: string }).id), user); if (!a) return noAccount(reply)
  const v = z.object({ path: z.string().min(1), uidValidity: z.string().min(1), flag: z.enum(['\\Seen', '\\Flagged']), enabled: z.boolean() }).parse(req.body)
  try { await setFlag(a, v.path, z.coerce.number().int().positive().parse((req.params as { uid: string }).uid), v.uidValidity, v.flag, v.enabled); return { ok: true } }
  catch (error) { if (error instanceof MailboxChanged) return reply.code(409).send({ code: 'MAILBOX_CHANGED', message: 'This folder changed on the server. Refresh it before updating the message.' }); return reply.code(502).send({ code: 'IMAP_FAILED', message: safeMailError(error) }) }
})

const draftInput = z.object({ accountId: z.uuid(), recipient: z.email().or(z.literal('')), subject: z.string().max(998), body: z.string().max(500000) })
app.get('/api/v1/drafts', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const { rows } = await pool.query('SELECT * FROM drafts WHERE user_id=$1 ORDER BY updated_at DESC', [user]); return rows
})
app.post('/api/v1/drafts', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const v = draftInput.parse(req.body); if (!await account(v.accountId, user)) return noAccount(reply)
  const id = randomUUID()
  const { rows } = await pool.query('INSERT INTO drafts(id,user_id,account_id,recipient,subject,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id,user,v.accountId,v.recipient,v.subject,v.body])
  return reply.code(201).send(rows[0])
})
app.patch('/api/v1/drafts/:id', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const v = draftInput.pick({ recipient: true, subject: true, body: true }).extend({ revision: z.number().int().positive() }).parse(req.body)
  const { rows } = await pool.query(`UPDATE drafts SET recipient=$1,subject=$2,body=$3,revision=revision+1,updated_at=now()
    WHERE id=$4 AND user_id=$5 AND revision=$6 RETURNING *`, [v.recipient,v.subject,v.body,asId((req.params as {id:string}).id),user,v.revision])
  if (!rows[0]) return reply.code(409).send({ code: 'DRAFT_CONFLICT', message: 'This draft changed elsewhere. Reload before saving.' })
  return rows[0]
})
app.post('/api/v1/drafts/:id/send', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const { rows } = await pool.query('SELECT * FROM drafts WHERE id=$1 AND user_id=$2', [asId((req.params as {id:string}).id),user])
  const draft = rows[0]; if (!draft) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Draft not found' })
  if (!z.email().safeParse(draft.recipient).success) return reply.code(400).send({ code: 'RECIPIENT_REQUIRED', message: 'Add one valid recipient' })
  const a = await account(draft.account_id, user); if (!a) return noAccount(reply)
  const id = randomUUID(), messageId = `<${id}@mailroom.local>`
  const raw = await prepareMail(a, draft.recipient, draft.subject, draft.body, messageId)
  const mimeBlob = encrypt(raw.toString('base64'), a.id)
  const inserted = await pool.query(`INSERT INTO send_intents(id,user_id,account_id,draft_id,message_id,recipient,subject,status,mime_blob)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (draft_id) WHERE draft_id IS NOT NULL DO NOTHING RETURNING id`,
    [id,user,a.id,draft.id,messageId,draft.recipient,draft.subject,'submitting',mimeBlob])
  if (!inserted.rowCount) return reply.code(409).send({ code: 'ALREADY_SUBMITTED', message: 'This draft already has a send attempt. Check SMTP activity before creating another message.' })
  try {
    const outcome = await sendRaw(a, draft.recipient, raw)
    const accepted = outcome.accepted.length > 0
    await pool.query('UPDATE send_intents SET status=$1,detail=$2,updated_at=now() WHERE id=$3', [accepted ? 'accepted_sent_copy_pending' : 'rejected', accepted ? 'Accepted by outgoing server; saving to Sent' : 'Recipient rejected', id])
    if (!accepted) return { id, status: 'rejected', messageId }
    try {
      const filing = await fileSent(a, raw, messageId)
      const status = filing === 'folder_missing' ? 'accepted_no_sent_folder' : 'filed'
      await pool.query('UPDATE send_intents SET status=$1,detail=$2,updated_at=now() WHERE id=$3', [status, filing === 'folder_missing' ? 'Accepted by SMTP; configure a Sent folder to save a copy' : 'Accepted by SMTP; copy present in Sent', id])
      return { id, status, messageId }
    } catch {
      await pool.query('UPDATE send_intents SET status=$1,detail=$2,updated_at=now() WHERE id=$3', ['filing_uncertain', 'Accepted by SMTP; could not confirm Sent copy', id])
      return { id, status: 'filing_uncertain', messageId }
    }
  } catch (error) {
    // A timeout after DATA may mean the remote server accepted the message.
    await pool.query('UPDATE send_intents SET status=$1,detail=$2,updated_at=now() WHERE id=$3', ['uncertain',safeMailError(error),id])
    return reply.code(502).send({ code: 'SEND_UNCERTAIN', message: 'Sending could not be confirmed. Do not resend until you check the recipient or server.', sendId: id })
  }
})
app.post('/api/v1/sends/:id/reconcile-sent', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const id = asId((req.params as {id:string}).id)
  const { rows } = await pool.query('SELECT * FROM send_intents WHERE id=$1 AND user_id=$2', [id,user])
  const intent = rows[0]
  if (!intent) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Send attempt not found' })
  if (!['accepted_sent_copy_pending', 'filing_uncertain', 'accepted_no_sent_folder'].includes(intent.status))
    return reply.code(409).send({ code: 'NOT_FILEABLE', message: 'Sent filing is unavailable for this send state' })
  const a = await account(intent.account_id, user); if (!a) return noAccount(reply)
  if (!intent.mime_blob) return reply.code(409).send({ code: 'MIME_UNAVAILABLE', message: 'The saved message is unavailable' })
  const raw = Buffer.from(decrypt(intent.mime_blob, a.id), 'base64')
  try {
    const filing = await fileSent(a, raw, intent.message_id)
    const status = filing === 'folder_missing' ? 'accepted_no_sent_folder' : 'filed'
    await pool.query('UPDATE send_intents SET status=$1,updated_at=now() WHERE id=$2', [status,id])
    return { id, status }
  } catch { return reply.code(502).send({ code: 'FILING_UNCERTAIN', message: 'Could not confirm a copy in Sent. The message was already accepted by SMTP.' }) }
})
app.get('/api/v1/activity/smtp', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return
  const { rows } = await pool.query('SELECT id,account_id,recipient,subject,status,detail,created_at,updated_at FROM send_intents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [user]); return rows
})

await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' })
