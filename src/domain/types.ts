import type { PullSignals } from './pullSignals';

export type IntegrationState = 'integrated' | 'pending' | 'unknown';
export type Lifecycle = 'active' | 'integrated' | 'quiet' | 'unverified';
export type View = 'map' | 'inventory' | 'people' | 'attention' | 'activity' | 'settings';

export interface GitRef {
  name: string;
  fullName: string;
  sha: string;
  updatedAt: string;
  subject: string;
  author?: string;
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
  repository?: string;
  headSha: string;
  updatedAt: string;
  author?: GitHubActor;
  requestedReviewers?: GitHubActor[];
  requestedTeams?: GitHubTeam[];
  signals?: PullSignals;
  observedAt?: string;
  retained?: boolean;
  sourceError?: string;
}
export interface GitHubActor {
  id: string;
  login: string;
  kind: 'user' | 'bot' | 'organization' | 'unknown';
}
export interface GitHubTeam {
  id: string;
  name: string;
  slug: string;
}
export interface GitHubPullRequest extends PullRequest {
  repository: string;
  headName: string;
  headRepository: string | null;
  observedAt: string;
}
export type CodingTool = 'codex' | 'claude-code' | 'cursor' | 'other' | 'unknown';
export type HandoffProvider = Extract<CodingTool, 'codex' | 'claude-code' | 'cursor'>;
export type LiveAgentTool = Extract<CodingTool, 'codex' | 'claude-code' | 'cursor'>;
export type RuntimeActivitySource = 'codex-runtime' | 'codex-hook' | 'claude-hook' | 'cursor-hook';
export interface ModelIdentity {
  id: string;
  provider?: 'openai' | 'anthropic' | 'xai' | 'other';
}
export interface TaskLink {
  id: string;
  tool?: CodingTool;
  model?: ModelIdentity;
  title: string;
  status: 'active' | 'idle' | 'unknown';
  association: 'verified' | 'possible';
  summary?: string;
  archived?: boolean;
  updatedAt?: string;
  checkedAt?: string;
  evidence?: string[];
  activitySource?: RuntimeActivitySource;
  waiting?: boolean;
  /** Local-only checkout path for a fresh verified runtime signal. */
  worktreePath?: string;
}
export interface OpenTaskCommand {
  repositoryId: string;
  branchId: string;
  taskId: string;
}
export type OpenTaskResult = 'sent' | 'not-linked' | 'invalid-link' | 'unavailable' | 'failed';
export interface HandoffSelection {
  repositoryId: string;
  branchId: string;
}
export interface HandoffProviderStatus {
  provider: HandoffProvider;
  installed: boolean;
  label: string;
}
export interface HandoffPlan {
  repositoryId: string;
  repositoryName: string;
  branches: { id: string; name: string; title: string }[];
  prompt: string;
}
export interface HandoffPreview {
  revision: string;
  branchCount: number;
  plans: HandoffPlan[];
  providers: HandoffProviderStatus[];
}
export interface AgentHandoff {
  id: string;
  provider: HandoffProvider;
  repositoryId: string;
  repositoryName: string;
  branchIds: string[];
  branchNames: string[];
  state: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  externalTaskId?: string;
  result?: string;
  error?: string;
}
export interface HandoffState {
  providers: HandoffProviderStatus[];
  handoffs: AgentHandoff[];
}
export interface HandoffCommand {
  provider: HandoffProvider;
  selections: HandoffSelection[];
  revision: string;
}
export interface HandoffResult {
  ok: boolean;
  state: HandoffState;
  createdIds: string[];
  error?: string;
}
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
  pullLookup?: {
    headSha: string;
    checkedAt: string;
    complete: boolean;
    found: boolean;
    error?: string;
  };
  tasks?: TaskLink[];
  codexNamed: boolean;
  detached: boolean;
}
export interface Target {
  name: string;
  sha: string;
  source: 'local' | 'cached-remote' | 'github';
  remote?: string;
  /** Repository default discovered from a symbolic remote HEAD. */
  role?: 'default';
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
    pulls?: GitHubPullRequest[];
    openPullsComplete?: boolean;
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
  liveState?: 'connected' | 'partial' | 'unavailable';
  liveCheckedAt?: string;
}
export interface ProviderStatus {
  codex: CodexStatus;
  github: GitHubStatus;
  agents?: AgentHistoryStatus[];
  liveAgents?: AgentLiveStatus[];
}
export interface AgentHistoryStatus {
  tool: CodingTool;
  enabled: boolean;
  state: 'not-connected' | 'reading' | 'ready' | 'error';
  checkedAt?: string;
  partial?: boolean;
  taskCount?: number;
  error?: string;
}
export interface AgentLiveStatus {
  tool: LiveAgentTool;
  enabled: boolean;
  installed: boolean;
  state: 'not-connected' | 'listening' | 'error';
  receivedAt?: string;
  activeCount: number;
  error?: string;
}
export interface GitStatus {
  state: 'checking' | 'ready' | 'missing' | 'unsupported' | 'unavailable';
  version?: string;
  installAvailable: boolean;
  message?: string;
}
export interface DesktopApi {
  teams?: import('../team/device').TeamDesktopApi;
  setAgentHistoryEnabled(tool: CodingTool, enabled: boolean): Promise<void>;
  onAgentHistory(callback: (statuses: AgentHistoryStatus[]) => void): () => void;
  setAgentLiveEnabled(tool: LiveAgentTool, enabled: boolean): Promise<AgentLiveStatus[]>;
  onAgentLive(callback: (statuses: AgentLiveStatus[]) => void): () => void;
  getDiscoveredProjects(): Promise<ProjectDiscoveryState>;
  followDiscoveredProjects(enabled: boolean): Promise<void>;
  refreshDiscoveredProjects(): Promise<void>;
  restoreDiscoveredProjects(): Promise<void>;
  onDiscoveredProjects(callback: (state: ProjectDiscoveryState) => void): () => void;
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
  revealWorktree(repositoryId: string, branchId?: string, worktreePath?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openLegalDocument(kind: 'notices' | 'chromium'): Promise<void>;
  getProviderStatus(): Promise<ProviderStatus>;
  connectGitHub(): Promise<GitHubStatus>;
  pollGitHub(): Promise<GitHubStatus>;
  disconnectGitHub(): Promise<void>;
  enablePublicGitHub(): Promise<void>;
  connectCodex(): Promise<void>;
  disconnectCodex(): Promise<void>;
  openCodexTask(command: OpenTaskCommand): Promise<OpenTaskResult>;
  getHandoffs(): Promise<HandoffState>;
  previewHandoff(selections: HandoffSelection[]): Promise<HandoffPreview>;
  sendHandoff(command: HandoffCommand): Promise<HandoffResult>;
  onHandoffs(callback: (state: HandoffState) => void): () => void;
  onCodex(callback: (status: CodexStatus) => void): () => void;
  onGitHub(callback: (status: GitHubStatus) => void): () => void;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
}

export interface DiscoveredProject {
  id: string;
  path: string;
  name: string;
  source: 'codex';
  available: boolean;
}
export interface ProjectDiscoveryState {
  enabled: boolean;
  scanning: boolean;
  projects: DiscoveredProject[];
  excludedCount: number;
  checkedAt?: string;
  error?: string;
  failedCount: number;
  pendingCount: number;
  recoveryNeeded?: boolean;
}

declare global {
  interface Window {
    openbranches?: DesktopApi;
  }
}
