import { safeStorage } from 'electron';
import type { AppStore } from '../services/store';
import type { TokenVault } from './auth';
import { createSecretVault } from '../services/secretVault';

/** The database holds only ciphertext. macOS Keychain protects its key. */
export function createTokenVault(store: AppStore): TokenVault {
  return createSecretVault(store, 'github.credentials', safeStorage);
}
