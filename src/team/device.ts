import { z } from 'zod';
import { consentSchema, sequence, teamId, sharedSnapshotSchema } from './protocol';
import { teamProjectSchema, teamWorkspaceSchema } from './responses';
export const deviceSecret = z.string().regex(/^obd_[\w-]{43}$/);
export const pairingResponse = z.strictObject({
  pairingSecret: deviceSecret,
  userCode: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
  expiresIn: z.number().int().positive().max(600),
  interval: z.number().int().min(5).max(60),
});
export const pairedIdentity = z.strictObject({
  deviceId: teamId,
  workspaceId: teamId,
  memberId: teamId,
  deviceName: z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(80),
  login: z.string().min(1).max(200),
  expiresAt: z.iso.datetime(),
});
export const pairingPollResponse = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  pairedIdentity.extend({ state: z.literal('paired') }),
]);
export const deviceShareSchema = z.strictObject({
  projectId: teamId,
  epoch: sequence.positive(),
  sequence,
  enabled: z.boolean(),
  consent: consentSchema,
  receivedAt: z.iso.datetime().nullable(),
});
export const companionResponse = z.strictObject({
  workspace: teamWorkspaceSchema,
  member: z.strictObject({ id: teamId, login: z.string().min(1).max(200) }),
  device: z.strictObject({
    id: teamId,
    name: z.string().min(1).max(100),
    expiresAt: z.iso.datetime(),
  }),
  projects: z.array(teamProjectSchema).max(1000),
  shares: z.array(deviceShareSchema).max(1000),
  complete: z.strictObject({ projects: z.boolean(), shares: z.boolean() }),
});
export type Companion = z.infer<typeof companionResponse>;
export type PairedIdentity = z.infer<typeof pairedIdentity>;
export const localPreviewRequest = z.strictObject({
  connectionId: teamId,
  repositoryId: z.string().min(1).max(512),
  projectId: teamId,
  consent: consentSchema,
});
export const sharingPreviewSchema = localPreviewRequest.extend({
  id: teamId,
  repositoryName: z.string(),
  projectName: z.string(),
  teamName: z.string(),
  expiresAt: z.number(),
  snapshot: sharedSnapshotSchema,
});
export type SharingPreview = z.infer<typeof sharingPreviewSchema>;
export interface TeamConnectionStatus {
  id: string;
  origin: string;
  deviceName: string;
  state: 'pairing' | 'connected' | 'removing' | 'unavailable';
  pairing?: { code: string; expiresAt: number };
  identity?: PairedIdentity;
  projects?: Companion['projects'];
  complete?: boolean;
  checkedAt?: number;
  error?: string;
}
export interface TeamConnectionsState {
  connections: TeamConnectionStatus[];
  allowLoopback: boolean;
  error?: string;
}
export interface TeamDesktopApi {
  getTeamConnections(): Promise<TeamConnectionsState>;
  connectTeam(input: { origin: string; deviceName: string }): Promise<TeamConnectionsState>;
  refreshTeamConnections(): Promise<TeamConnectionsState>;
  disconnectTeam(id: string): Promise<TeamConnectionsState>;
  forgetTeam(id: string): Promise<TeamConnectionsState>;
  openTeam(id: string): Promise<void>;
  previewTeamSharing(input: z.infer<typeof localPreviewRequest>): Promise<SharingPreview>;
  onTeamConnections(callback: (state: TeamConnectionsState) => void): () => void;
}
