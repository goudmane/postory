import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { assertKey, decrypt, encrypt } from '../src/security.ts'
import { prepareMail, validateHost } from '../src/mail.ts'

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')

test('credential envelope is bound to the account and rejects tampering', () => {
  assertKey()
  const encrypted = encrypt('private password', 'account-one')
  assert.equal(decrypt(encrypted, 'account-one'), 'private password')
  assert.throws(() => decrypt(encrypted, 'account-two'))
  assert.throws(() => decrypt({ ...encrypted, ciphertext: randomBytes(16).toString('base64') }, 'account-one'))
})

test('manual mail targets reject local and raw private addresses', async () => {
  await assert.rejects(validateHost('localhost'))
  await assert.rejects(validateHost('127.0.0.1'))
  await assert.rejects(validateHost('10.1.2.3'))
  await assert.rejects(validateHost('metadata.google.internal.local'))
})

test('outbound MIME keeps the fixed Message-ID and plain text', async () => {
  const raw = await prepareMail({ email: 'from@example.com' } as any, 'to@example.com', 'Subject', 'Hello', '<fixed@example.com>')
  const mime = raw.toString('utf8')
  assert.match(mime, /Message-ID: <fixed@example\.com>/i)
  assert.match(mime, /Hello/)
  assert.match(mime, /To: to@example\.com/i)
})
