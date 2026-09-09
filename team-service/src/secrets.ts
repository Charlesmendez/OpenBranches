import { createHash, randomBytes } from 'node:crypto';

export const secret = (prefix = 'obs') => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const validSecret = (value: unknown): value is string =>
  typeof value === 'string' && /^ob[spd]_[\w-]{43}$/.test(value);
export function pairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
    .join('')
    .match(/.{4}/g)!
    .join('-');
}
