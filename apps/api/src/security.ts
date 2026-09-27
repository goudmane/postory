import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type Envelope = { nonce: string; ciphertext: string; tag: string }

function key() {
  const secret = Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'base64')
  if (secret.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be a base64 encoded 32-byte key')
  return secret
}

export function assertKey() { key() }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function encrypt(value: string, accountId: string): Envelope {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  cipher.setAAD(Buffer.from(accountId))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decrypt(envelope: Envelope, accountId: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.nonce, 'base64'))
  decipher.setAAD(Buffer.from(accountId))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}
