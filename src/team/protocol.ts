import { z } from 'zod';

export const teamId = z.uuid();
export const sequence = z.number().int().nonnegative().safe();
export const consentSchema = z.strictObject({
  taskTitles: z.boolean(),
  taskSummaries: z.boolean(),
});
export type ShareConsent = z.infer<typeof consentSchema>;
const sha = z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/);
const label = z.string().min(1).max(512);
const count = z.number().int().nonnegative().max(1_000_000);
const task = z.strictObject({
  key: z.string().regex(/^[a-f\d]{64}$/),
  tool: z.enum(['codex', 'claude-code', 'cursor', 'other', 'unknown']),
  model: z
    .strictObject({
      id: label,
      provider: z.enum(['openai', 'anthropic', 'xai', 'other']).optional(),
    })
    .optional(),
  association: z.enum(['verified', 'possible']),
  title: z.string().max(512).optional(),
  summary: z.string().max(1024).optional(),
  checkedAt: z.iso.datetime().optional(),
});
export const sharedBranchSchema = z.strictObject({
  key: z.string().regex(/^[a-f\d]{64}$/),
  name: label,
  detached: z.boolean(),
  localSha: sha.nullable(),
  remote: z
    .strictObject({ name: label, sha, presence: z.enum(['present', 'missing', 'unknown']) })
    .optional(),
  worktrees: z
    .strictObject({
      total: count,
      available: count,
      dirty: count.nullable(),
      changedFiles: count.nullable(),
    })
    .refine(
      (value) =>
        value.available <= value.total && (value.dirty === null || value.dirty <= value.available),
      'Working-copy counts are inconsistent.',
    ),
  integration: z
    .array(
      z.strictObject({ name: label, sha, state: z.enum(['integrated', 'pending', 'unknown']) }),
    )
    .max(8),
  tasks: z.array(task).max(10),
  omittedTasks: count,
});
export const sharedSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    observedAt: z.iso.datetime(),
    branches: z.array(sharedBranchSchema).max(1000),
    omittedBranches: count,
    sourceError: z.boolean(),
  })
  .superRefine((value, context) => {
    if (new Set(value.branches.map((branch) => branch.key)).size !== value.branches.length)
      context.addIssue({ code: 'custom', message: 'Branch keys must be unique.' });
  });
export type SharedSnapshot = z.infer<typeof sharedSnapshotSchema>;
export const publishSchema = z.strictObject({
  epoch: sequence.positive(),
  sequence: sequence.positive(),
  snapshot: sharedSnapshotSchema,
});
export const sharingChangeSchema = z.strictObject({
  expectedEpoch: sequence,
  enabled: z.boolean(),
  consent: consentSchema,
});
export const pairingStartSchema = z.strictObject({ deviceName: z.string().trim().min(1).max(80) });
export const pairingApprovalSchema = z.strictObject({
  workspaceId: teamId,
  userCode: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
});

export interface TeamPerson {
  id: string;
  githubId: string;
  login: string;
  role: 'owner' | 'member';
}
export interface TeamProject {
  id: string;
  name: string;
  githubId: string | null;
  githubSlug: string | null;
  canShare: boolean;
}
export interface TeamWorkspace {
  id: string;
  name: string;
  revision: string;
}
export interface SharedWork {
  projectId: string;
  deviceId: string;
  memberId: string;
  deviceName: string;
  deviceExpiresAt: string;
  epoch: number;
  sequence: number;
  receivedAt: string;
  snapshot: SharedSnapshot;
}
export interface TeamView {
  workspace: TeamWorkspace;
  people: TeamPerson[];
  projects: TeamProject[];
  work: SharedWork[];
  checkedAt: string;
  coverage: { people: boolean; projects: boolean };
}

/** The server enforces the stored consent, independently of the companion. */
export function snapshotWithinConsent(snapshot: SharedSnapshot, consent: ShareConsent) {
  return snapshot.branches.every((branch) =>
    branch.tasks.every(
      (task) =>
        (consent.taskTitles || task.title === undefined) &&
        (consent.taskSummaries || task.summary === undefined),
    ),
  );
}

export function sharedWorkStale(
  work: Pick<SharedWork, 'receivedAt' | 'deviceExpiresAt' | 'snapshot'>,
  now = Date.now(),
) {
  const received = Date.parse(work.receivedAt),
    observed = Date.parse(work.snapshot.observedAt),
    expires = Date.parse(work.deviceExpiresAt);
  return (
    work.snapshot.sourceError ||
    ![received, observed, expires].every(Number.isFinite) ||
    expires <= now ||
    received > now + 60_000 ||
    observed > now + 60_000 ||
    now - received > 5 * 60_000 ||
    now - observed > 5 * 60_000
  );
}
