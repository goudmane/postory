import dns from 'node:dns/promises'
import net from 'node:net'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { simpleParser } from 'mailparser'
import type { Envelope } from './security.js'
import { decrypt } from './security.js'

export type Account = {
  id: string; user_id: string; email: string; label: string;
  imap_host: string; imap_port: number; imap_secure: boolean;
  smtp_host: string; smtp_port: number; smtp_secure: boolean;
  username: string; credential: Envelope; sent_path: string | null
}

// Mail hosts may resolve differently after a DNS rebinding. The reference deployment also
// needs an egress firewall; applications alone cannot guarantee network isolation.
export async function validateHost(host: string) {
  if (!/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host)) throw new Error('Invalid mail server hostname')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || net.isIP(host)) throw new Error('Use a public DNS hostname')
  const records = await dns.lookup(host, { all: true })
  if (!records.length || records.some(({ address }) => {
    if (net.isIP(address) === 6) return /^(?:fc|fd|fe80|::1)/i.test(address)
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224
  })) throw new Error('Mail host resolves to a private or reserved address')
}

export async function connectImap(account: Account) {
  await validateHost(account.imap_host)
  const client = new ImapFlow({
    host: account.imap_host, port: account.imap_port, secure: account.imap_secure,
    auth: { user: account.username, pass: decrypt(account.credential, account.id) },
    logger: false, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000
  })
  await client.connect()
  return client
}

export async function testAccount(account: Account) {
  const stages: { stage: string; ok: boolean; detail?: string }[] = []
  let client: ImapFlow | undefined
  try {
    const t = Date.now()
    client = await connectImap(account)
    stages.push({ stage: 'IMAP connection and authentication', ok: true, detail: `${Date.now() - t} ms` })
    const folders = await client.list()
    stages.push({ stage: 'Folders', ok: true, detail: `${folders.length} available` })
    const sent = folders.find(f => f.specialUse === '\\Sent')?.path || null
    await validateHost(account.smtp_host)
    const transport = nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port, secure: account.smtp_secure,
      requireTLS: !account.smtp_secure, auth: { user: account.username, pass: decrypt(account.credential, account.id) },
      connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000, tls: { rejectUnauthorized: true },
      logger: false, debug: false
    })
    const t2 = Date.now()
    await transport.verify()
    stages.push({ stage: 'SMTP connection and authentication', ok: true, detail: `${Date.now() - t2} ms; this does not test recipient acceptance` })
    transport.close()
    return { stages, sentPath: sent }
  } catch (error) {
    stages.push({ stage: stages.length ? 'SMTP or folder check' : 'IMAP connection', ok: false, detail: safeMailError(error) })
    return { stages, sentPath: null }
  } finally { if (client) await client.logout().catch(() => {}) }
}

export function safeMailError(error: unknown): string {
  const err = error as { code?: string; responseCode?: number }
  if (err.responseCode) return `Server rejected the request (${err.responseCode})`
  const codes: Record<string, string> = {
    EAUTH: 'The mail server rejected the credentials', ECONNREFUSED: 'The mail server refused the connection',
    ETIMEDOUT: 'The mail server did not respond in time', ENOTFOUND: 'Mail server hostname was not found',
    ESOCKET: 'Mail server connection failed', ETLS: 'TLS verification failed'
  }
  return codes[err.code || ''] || 'The mail server could not complete this operation. Check the account settings and server status.'
}

export async function folders(account: Account) {
  const client = await connectImap(account)
  try { return (await client.list()).map(f => ({ path: f.path, name: f.name, role: f.specialUse || null })) }
  finally { await client.logout().catch(() => {}) }
}

export async function messages(account: Account, path: string, page: number) {
  const client = await connectImap(account)
  try {
    const lock = await client.getMailboxLock(path)
    try {
      const count = client.mailbox ? client.mailbox.exists || 0 : 0
      const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : ''
      const end = Math.max(0, count - page * 40)
      const start = Math.max(1, end - 39)
      if (!end) return { items: [], hasMore: false, total: count, uidValidity }
      const items = []
      for await (const m of client.fetch(`${start}:${end}`, { uid: true, envelope: true, flags: true, internalDate: true, size: true })) {
        items.push({ uid: m.uid, subject: m.envelope?.subject || '(No subject)', from: m.envelope?.from?.[0]?.address || '',
          date: m.internalDate, size: m.size, seen: m.flags?.has('\\Seen') || false, starred: m.flags?.has('\\Flagged') || false })
      }
      return { items: items.reverse(), hasMore: start > 1, total: count, uidValidity }
    } finally { lock.release() }
  } finally { await client.logout().catch(() => {}) }
}

export class MailboxChanged extends Error {}
export async function message(account: Account, path: string, uid: number, expectedUidValidity: string) {
  const client = await connectImap(account)
  try {
    const lock = await client.getMailboxLock(path)
    try {
      if (String(client.mailbox && client.mailbox.uidValidity) !== expectedUidValidity) throw new MailboxChanged('Mailbox identity changed')
      const found = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true })
      if (!found || !found.source) return null
      if (found.source.length > 15 * 1024 * 1024) throw new Error('Message exceeds the current viewer limit')
      const parsed = await simpleParser(found.source)
      // HTML is deliberately not returned until isolated rendering is implemented.
      return { uid, subject: parsed.subject || '(No subject)', from: parsed.from?.text || '',
        to: Array.isArray(parsed.to) ? parsed.to.map(v => v.text).join(', ') : parsed.to?.text || '', date: parsed.date, text: parsed.text || '[This message has no plain-text part]',
        attachments: parsed.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size })) }
    } finally { lock.release() }
  } finally { await client.logout().catch(() => {}) }
}

export async function setFlag(account: Account, path: string, uid: number, expectedUidValidity: string, flag: '\\Seen' | '\\Flagged', enabled: boolean) {
  const client = await connectImap(account)
  try { const lock = await client.getMailboxLock(path); try {
    if (String(client.mailbox && client.mailbox.uidValidity) !== expectedUidValidity) throw new MailboxChanged('Mailbox identity changed')
    if (enabled) await client.messageFlagsAdd(uid, [flag], { uid: true })
    else await client.messageFlagsRemove(uid, [flag], { uid: true })
  } finally { lock.release() } } finally { await client.logout().catch(() => {}) }
}

export async function prepareMail(account: Account, recipient: string, subject: string, body: string, messageId: string): Promise<Buffer> {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true })
  const compiled = await composer.sendMail({ from: account.email, to: recipient, subject, text: body, messageId })
  if (!Buffer.isBuffer(compiled.message)) throw new Error('MIME compilation did not return a buffer')
  return compiled.message
}

export async function sendRaw(account: Account, recipient: string, raw: Buffer) {
  await validateHost(account.smtp_host)
  const transport = nodemailer.createTransport({ host: account.smtp_host, port: account.smtp_port,
    secure: account.smtp_secure, requireTLS: !account.smtp_secure,
    auth: { user: account.username, pass: decrypt(account.credential, account.id) },
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000,
    tls: { rejectUnauthorized: true }, logger: false, debug: false })
  try {
    const outcome = await transport.sendMail({ envelope: { from: account.email, to: [recipient] }, raw })
    return outcome
  }
  finally { transport.close() }
}

export async function fileSent(account: Account, raw: Buffer, messageId: string): Promise<'filed'|'already_filed'|'folder_missing'> {
  if (!account.sent_path) return 'folder_missing'
  const client = await connectImap(account)
  try {
    const lock = await client.getMailboxLock(account.sent_path)
    try {
      const existing = await client.search({ header: { 'Message-ID': messageId } }, { uid: true })
      if (existing && existing.length) return 'already_filed'
      await client.append(account.sent_path, raw, ['\\Seen'])
      return 'filed'
    } finally { lock.release() }
  } finally { await client.logout().catch(() => {}) }
}
