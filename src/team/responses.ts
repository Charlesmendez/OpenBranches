import { z } from 'zod';
import { sharedSnapshotSchema, teamId, sequence } from './protocol';
const name = z.string().min(1).max(512);
const revision = z.string().regex(/^\d+$/);
export const teamPersonSchema = z.strictObject({
  id: teamId,
  githubId: z.string().regex(/^\d+$/),
  login: name,
  role: z.enum(['owner', 'member']),
});
export const teamProjectSchema = z.strictObject({
  id: teamId,
  name,
  githubId: z.string().nullable(),
  githubSlug: z.string().nullable(),
  canShare: z.boolean(),
});
export const teamWorkspaceSchema = z.strictObject({ id: teamId, name, revision });
export const sharedWorkSchema = z.strictObject({
  projectId: teamId,
  deviceId: teamId,
  memberId: teamId,
  deviceName: name,
  deviceExpiresAt: z.iso.datetime(),
  epoch: sequence.positive(),
  sequence: sequence.positive(),
  receivedAt: z.iso.datetime(),
  snapshot: sharedSnapshotSchema,
});
export const teamSessionSchema = z.strictObject({
  user: z.strictObject({ id: teamId, githubId: z.string().regex(/^\d+$/), login: name }),
  canCreateWorkspace: z.boolean(),
  complete: z.boolean(),
  workspaces: z.array(teamWorkspaceSchema.extend({ role: z.enum(['owner', 'member']) })).max(100),
});
export type TeamSession = z.infer<typeof teamSessionSchema>;
export const teamViewSchema = z.strictObject({
  workspace: teamWorkspaceSchema,
  people: z.array(teamPersonSchema).max(1000),
  projects: z.array(teamProjectSchema).max(1000),
  work: z.array(sharedWorkSchema).max(10),
  live: z
    .strictObject({
      work: z.array(sharedWorkSchema).max(24),
      total: sequence,
      complete: z.boolean(),
    })
    .optional(),
  checkedAt: z.iso.datetime(),
  coverage: z.strictObject({ people: z.boolean(), projects: z.boolean() }),
  nextCursor: z
    .string()
    .regex(/^[a-f\d-]{36}:[a-f\d-]{36}$/)
    .nullable(),
  totals: z.strictObject({
    people: sequence,
    projects: sequence,
    reports: sequence,
    snapshots: sequence,
    stale: sequence,
    omitted: sequence,
  }),
});
export type TeamPage = z.infer<typeof teamViewSchema>;
export const teamDevicesSchema = z.strictObject({
  devices: z
    .array(
      z.strictObject({
        id: teamId,
        memberId: teamId,
        name,
        expiresAt: z.iso.datetime(),
        revokedAt: z.iso.datetime().nullable(),
        lastSeenAt: z.iso.datetime().nullable(),
      }),
    )
    .max(1000),
  complete: z.boolean(),
});
export type TeamDevices = z.infer<typeof teamDevicesSchema>;
export const projectAccessSchema = z.strictObject({
  members: z
    .array(z.strictObject({ memberId: teamId, enabled: z.boolean(), canShare: z.boolean() }))
    .max(1000),
  complete: z.boolean(),
});
export type ProjectAccess = z.infer<typeof projectAccessSchema>;

export type TeamPerson = z.infer<typeof teamPersonSchema>;
export type TeamProject = z.infer<typeof teamProjectSchema>;
export type TeamWorkspace = z.infer<typeof teamWorkspaceSchema>;
export type SharedWork = z.infer<typeof sharedWorkSchema>;
export type TeamView = Omit<TeamPage, 'nextCursor'>;
