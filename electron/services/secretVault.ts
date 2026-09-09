import type { AppStore } from './store';
export interface SecretVault {
  read(): string | undefined;
  write(value: string | undefined): void;
}
interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** All callers choose a fixed application-owned key. Only ciphertext reaches SQLite. */
export function createSecretVault(
  store: Pick<AppStore, 'readStrict' | 'write'>,
  key: string,
  cipher: Cipher,
): SecretVault {
  return {
    read() {
      const saved = store.readStrict(key);
      if (saved === undefined || saved === null) return undefined;
      if (
        typeof saved !== 'string' ||
        saved.length > 2_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(saved)
      )
        throw new Error('Saved connection data is unreadable.');
      if (!cipher.isEncryptionAvailable()) throw new Error('macOS Keychain is unavailable.');
      return cipher.decryptString(Buffer.from(saved, 'base64'));
    },
    write(value) {
      if (value === undefined) {
        store.write(key, null);
        return;
      }
      if (!cipher.isEncryptionAvailable())
        throw new Error('macOS Keychain is unavailable. The connection was not saved.');
      store.write(key, cipher.encryptString(value).toString('base64'));
    },
  };
}
