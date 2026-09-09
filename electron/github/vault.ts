import { safeStorage } from 'electron';
import type { AppStore } from '../services/store';
import type { TokenVault } from './auth';

/** The database holds only ciphertext. macOS Keychain protects its key. */
export function createTokenVault(store: AppStore): TokenVault {
  return {
    read() {
      const encrypted = store.read<string | null>('github.credentials', null);
      if (!encrypted) return undefined;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain is unavailable.');
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    },
    write(value) {
      if (!value) {
        store.write('github.credentials', null);
        return;
      }
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('macOS Keychain is unavailable. GitHub sign-in was not saved.');
      store.write('github.credentials', safeStorage.encryptString(value).toString('base64'));
    },
  };
}
