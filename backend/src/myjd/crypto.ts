import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'

export const sha256 = (...parts: Buffer[]): Buffer => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

export const hmacSha256Hex = (data: string, key: Buffer): string =>
  createHmac('sha256', key).update(data).digest('hex')

// The 32 byte secret is split: first 16 bytes = IV, last 16 bytes = AES-128 key.
export const encrypt = (plain: string, secret: Buffer): string => {
  const cipher = createCipheriv('aes-128-cbc', secret.subarray(16, 32), secret.subarray(0, 16))
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64')
}

export const decrypt = (base64: string, secret: Buffer): string => {
  const decipher = createDecipheriv('aes-128-cbc', secret.subarray(16, 32), secret.subarray(0, 16))
  return Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8')
}
