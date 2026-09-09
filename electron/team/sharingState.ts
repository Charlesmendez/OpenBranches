import { z } from 'zod';
import { consentSchema, sequence, teamId } from '../../src/team/protocol';
import type { SecretVault } from '../services/secretVault';

export const shareRecord = z.strictObject({
  id: teamId,
  connectionId: teamId,
  repositoryId: z.string().min(1).max(512),
  projectId: teamId,
  repositoryName: z.string().max(1024),
  projectName: z.string().max(1024),
  teamName: z.string().max(1024),
  state: z.enum(['starting', 'sharing', 'stopping', 'stopped', 'paused']),
  consent: consentSchema,
  epoch: sequence,
  sequence,
  approvalExpiresAt: z.number().finite(),
  lastUploadedAt: z.number().finite().optional(),
  observedAt: z.iso.datetime().optional(),
  digest: z
    .string()
    .regex(/^[a-f\d]{64}$/)
    .optional(),
  reason: z.string().max(500).optional(),
});
export type ShareRecord = z.infer<typeof shareRecord>;
const saved = z.strictObject({ version: z.literal(1), shares: z.array(shareRecord).max(200) });

/** Prepared writes can join the repository-removal SQLite transaction. Call the
 * returned adoption only after that transaction commits. No snapshots are saved. */
export class SharingRegistry {
  private records: ShareRecord[] = [];
  error?: string;
  constructor(private vault: SecretVault) {
    this.read();
  }
  read() {
    try {
      const text = this.vault.read();
      const records = text ? saved.parse(JSON.parse(text)).shares : [];
      if (
        new Set(records.map((r) => r.id)).size !== records.length ||
        new Set(records.map((r) => r.connectionId + ':' + r.projectId)).size !== records.length
      )
        throw new Error('Duplicate sharing records.');
      this.records = records;
      this.error = undefined;
    } catch {
      this.records = [];
      this.error =
        'Saved sharing choices could not be opened. No local work will be uploaded. Unlock Keychain and retry.';
    }
  }
  all() {
    return this.records;
  }
  get(id: string) {
    return this.records.find((r) => r.id === id);
  }
  prepare(records: ShareRecord[]) {
    if (this.error) throw new Error(this.error);
    const value = saved.parse({ version: 1, shares: records });
    this.vault.write(JSON.stringify(value));
    // Keep immutable record identities for cancellation checks.
    return () => {
      this.records = records;
    };
  }
  save(records: ShareRecord[]) {
    this.prepare(records)();
  }
  replace(record: ShareRecord) {
    this.save(this.records.map((r) => (r.id === record.id ? record : r)));
    return record;
  }
}
