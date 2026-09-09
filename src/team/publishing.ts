import type { ShareConsent } from './protocol';

export interface TeamShareStatus {
  id: string;
  connectionId: string;
  repositoryId: string;
  projectId: string;
  repositoryName: string;
  projectName: string;
  teamName: string;
  state: 'starting' | 'sharing' | 'stopping' | 'stopped' | 'paused';
  consent: ShareConsent;
  lastUploadedAt?: number;
  observedAt?: string;
  error?: string;
  busy: boolean;
  stopSaved: boolean;
}
export interface TeamSharingState {
  shares: TeamShareStatus[];
  error?: string;
}
export interface TeamPublishingApi {
  getTeamSharing(): Promise<TeamSharingState>;
  approveTeamSharing(previewId: string): Promise<TeamSharingState>;
  stopTeamSharing(id: string): Promise<TeamSharingState>;
  forgetTeamSharing(id: string): Promise<TeamSharingState>;
  refreshTeamSharing(): Promise<TeamSharingState>;
  onTeamSharing(callback: (state: TeamSharingState) => void): () => void;
}
