export type IntegrationState = 'integrated' | 'pending' | 'unknown';
export type Lifecycle = 'active' | 'integrated' | 'quiet' | 'unverified';
export type View = 'map' | 'inventory' | 'attention' | 'activity' | 'settings';

export interface GitRef {
  name: string;
  fullName: string;
  sha: string;
  updatedAt: string;
  subject: string;
  remote?: string;
  upstream?: string;
  source?: 'github';
  checkedAt?: string;
  presence?: 'present' | 'missing' | 'unknown';
}
export interface Worktree {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  available: boolean;
  dirty: boolean | null;
  changedFiles: number | null;
  statusNote?: string;
  prunable?: string;
  locked?: string;
}
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  draft?: boolean;
  base: string;
  headSha: string;
  updatedAt: string;
}
export interface TaskLink {
  id: string;
  title: string;
  status: 'active' | 'idle' | 'unknown';
  association: 'verified' | 'possible';
  summary?: string;
  archived?: boolean;
  updatedAt?: string;
  checkedAt?: string;
  evidence?: string[];
}
export interface OpenTaskCommand {
  repositoryId: string;
  branchId: string;
  taskId: string;
}
export type OpenTaskResult = 'sent' | 'not-linked' | 'invalid-link' | 'unavailable' | 'failed';
export interface Branch {
  id: string;
  repositoryId: string;
  name: string;
  title: string;
  local?: GitRef;
  remote?: GitRef;
  worktrees: Worktree[];
  updatedAt: string;
  integration: Record<string, IntegrationState>;
  remoteIntegration?: Record<string, IntegrationState>;
  publishedHistory?: {
    repository: string;
    remoteName: string;
    branchSha: string;
    checkedAt: string;
    unavailable: boolean;
    partial?: boolean;
    targets: {
      name: string;
      sha: string;
      state: IntegrationState;
      checkedAt?: string;
      source?: 'git' | 'github' | 'identical';
    }[];
    error?: string;
  };
  pullRequest?: PullRequest;
  tasks?: TaskLink[];
  codexNamed: boolean;
  detached: boolean;
}
export interface Target {
  name: string;
  sha: string;
  source: 'local' | 'cached-remote' | 'github';
  remote?: string;
}
export interface Repository {
  id: string;
  name: string;
  path: string;
  commonDir: string;
  targets: Target[];
  branches: Branch[];
  worktrees: Worktree[];
  remotes: { name: string; url: string }[];
  scannedAt: string;
  error?: string;
  shallow: boolean;
  github?: {
    checkedAt: string;
    partial: boolean;
    error?: string;
    history?: { checked: number; total: number; error?: string };
  };
}
export interface ActivityEvent {
  id: string;
  repositoryId: string;
  branchId?: string;
  kind: 'commit' | 'branch' | 'worktree' | 'integration';
  title: string;
  detail: string;
  at: string;
}
export interface Snapshot {
  repositories: Repository[];
  events: ActivityEvent[];
  updatedAt: string;
  scanning: boolean;
}
export interface Recommendation {
  id: string;
  revision: string;
  repositoryId: string;
  branchId: string;
  category: 'local-only' | 'forgotten' | 'integration-gap' | 'verify';
  title: string;
  explanation: string;
  evidence: string[];
  checkedAt: string;
  priority: 'review' | 'notice';
}
export interface ReviewDecision {
  id: string;
  repositoryId: string;
  revision: string;
  choice: 'dismissed' | 'snoozed';
  decidedAt: number;
  until?: number;
}
export interface ReviewState {
  decisions: ReviewDecision[];
  error?: string;
}
export interface ReviewCommand {
  id: string;
  revision: string;
  choice: 'dismissed' | 'snoozed' | 'restore';
}
export interface ReviewResult {
  ok: boolean;
  state: ReviewState;
  error?: string;
}
export interface GitHubStatus {
  connected: boolean;
  configured: boolean;
  enabled?: boolean;
  login?: string;
  error?: string;
  device?: { code: string; verificationUrl: string; expiresAt: number };
}
export interface CodexUsageBucket {
  id: string;
  available: boolean;
  exhausted: boolean;
  primary?: { usedPercent: number; resetsAt?: number; windowDurationMins?: number };
  secondary?: { usedPercent: number; resetsAt?: number; windowDurationMins?: number };
}
export interface CodexAccount {
  auth: 'chatgpt' | 'other' | 'signed-out' | 'unavailable';
  checkedAt: string;
  limits: CodexUsageBucket[];
  error?: string;
}
export interface CodexStatus {
  installed: boolean;
  enabled: boolean;
  version?: string;
  state: 'not-connected' | 'connecting' | 'ready' | 'unavailable' | 'error';
  checkedAt?: string;
  partial?: boolean;
  taskCount?: number;
  error?: string;
  account?: CodexAccount;
}
export interface ProviderStatus {
  codex: CodexStatus;
  github: GitHubStatus;
}
export interface GitStatus {
  state: 'checking' | 'ready' | 'missing' | 'unsupported' | 'unavailable';
  version?: string;
  installAvailable: boolean;
  message?: string;
}
export interface DesktopApi {
  getReviews(): Promise<ReviewState>;
  decideReview(command: ReviewCommand): Promise<ReviewResult>;
  resetReviews(repositoryId?: string): Promise<ReviewResult>;
  onReviews(callback: (state: ReviewState) => void): () => void;
  checkGit(): Promise<GitStatus>;
  installGit(): Promise<void>;
  openGitSetupGuide(): Promise<void>;
  onGit(callback: (status: GitStatus) => void): () => void;
  getSnapshot(): Promise<Snapshot>;
  addRepository(): Promise<Repository | null>;
  removeRepository(id: string): Promise<void>;
  refresh(): Promise<void>;
  revealWorktree(repositoryId: string, branchId?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getProviderStatus(): Promise<ProviderStatus>;
  connectGitHub(): Promise<GitHubStatus>;
  pollGitHub(): Promise<GitHubStatus>;
  disconnectGitHub(): Promise<void>;
  enablePublicGitHub(): Promise<void>;
  connectCodex(): Promise<void>;
  disconnectCodex(): Promise<void>;
  openCodexTask(command: OpenTaskCommand): Promise<OpenTaskResult>;
  onCodex(callback: (status: CodexStatus) => void): () => void;
  onGitHub(callback: (status: GitHubStatus) => void): () => void;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
}

declare global {
  interface Window {
    openbranches?: DesktopApi;
  }
}
