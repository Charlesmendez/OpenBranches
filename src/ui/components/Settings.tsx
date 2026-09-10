import { AgentHistoryConnection } from './AgentHistoryConnection';
import { AgentLiveConnections } from './AgentLiveConnections';
import { lazy, Suspense, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Cable,
  Check,
  Cloud,
  Copy,
  FileText,
  Laptop,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import type { GitHubStatus, Repository } from '../../domain/types';
import { useProviders } from '../hooks/useProviders';
import { CodexConnection } from './CodexConnection';
import { GitSetup } from './GitSetup';
import type { GitSetupController } from '../hooks/useGit';
import { MonitoredProjects } from './MonitoredProjects';
import { ProjectDiscovery } from './ProjectDiscovery';
import { ConnectionSummary } from './ConnectionSummary';
import { SettingsNavigation, type SettingsSection } from './SettingsNavigation';
import './settings.css';
const TeamConnectionsPanel = lazy(() =>
  import('./TeamConnections').then((module) => ({ default: module.TeamConnectionsPanel })),
);
export type SettingsFocus = SettingsSection | 'live-activity';

const sectionForFocus = (focus: SettingsFocus | undefined): SettingsSection =>
  focus === 'live-activity' ? 'connections' : (focus ?? 'projects');

export function Settings({
  git,
  repositories,
  demo,
  onRemove,
  onAdd,
  onLive,
  focusSection,
}: {
  git: GitSetupController;
  repositories: Repository[];
  demo: boolean;
  onRemove: (id: string) => Promise<boolean>;
  onAdd: () => void;
  onLive: () => void;
  focusSection?: SettingsFocus;
}) {
  const providers = useProviders();
  const [github, setGitHub] = useState<GitHubStatus>(providers.github);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [legalBusy, setLegalBusy] = useState<'notices' | 'chromium'>();
  const [legalError, setLegalError] = useState('');
  const [section, setSection] = useState<SettingsSection>(() => sectionForFocus(focusSection));
  useEffect(() => setGitHub(providers.github), [providers.github]);
  useEffect(() => {
    if (focusSection) setSection(sectionForFocus(focusSection));
  }, [focusSection]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const connect = () =>
    action(async () => {
      const result = await window.openbranches!.connectGitHub();
      setGitHub(result);
      if (result.device) await window.openbranches!.openExternal(result.device.verificationUrl);
    });
  const copyCode = () =>
    action(async () => {
      if (github.device) {
        await navigator.clipboard.writeText(github.device.code);
        setCopied(true);
      }
    });
  const openLegalDocument = async (kind: 'notices' | 'chromium') => {
    if (!window.openbranches) return;
    setLegalBusy(kind);
    setLegalError('');
    try {
      await window.openbranches.openLegalDocument(kind);
    } catch {
      setLegalError('The license document could not be opened. Try again from the installed app.');
    } finally {
      setLegalBusy(undefined);
    }
  };
  return (
    <div className="settings-content">
      <SettingsNavigation
        selected={section}
        projectCount={repositories.length}
        demo={demo}
        onSelect={setSection}
      />
      <div className="settings-panel">
        {section === 'projects' && (
          <>
            <ProjectDiscovery key={String(demo)} demo={demo} />
            <MonitoredProjects
              repositories={repositories}
              demo={demo}
              onRemove={onRemove}
              onAdd={onAdd}
              onLive={onLive}
            />
          </>
        )}
        {section === 'team' && !demo && (
          <Suspense
            fallback={
              <section className="settings-section" role="status">
                Loading team connections…
              </section>
            }
          >
            <TeamConnectionsPanel demo={false} repositories={repositories} />
          </Suspense>
        )}
        {section === 'connections' && (
          <>
            <div className="settings-panel-intro">
              <div className="section-kicker">CONNECTIONS</div>
              <h2>Bring the useful signals together.</h2>
              <p>
                Start with Git on this Mac. Add only the published work, task history, and live
                coding tools you want OpenBranches to recognize.
              </p>
            </div>
            <ConnectionSummary git={git.status} providers={{ ...providers, github }} demo={demo} />
            <section className="settings-section">
              <div className="settings-group-label">Repositories</div>
              <div className="settings-row">
                <span className="settings-icon">
                  <Laptop size={20} />
                </span>
                <div>
                  <h3>This Mac</h3>
                  <p>
                    {git.status?.state === 'ready'
                      ? `Git ${git.status.version} is ready. Your selected repositories and worktrees stay in place.`
                      : !git.status
                        ? 'Connect local repositories in the desktop app.'
                        : 'Finish Git setup to read your selected repositories and worktrees.'}
                  </p>
                </div>
                {git.status?.state === 'ready' && (
                  <span className="pill blue">
                    <Check size={12} />
                    Local inspection
                  </span>
                )}
              </div>
              <GitSetup git={git} compact />
              <div className="settings-row">
                <span className="settings-icon">
                  <Cloud size={20} />
                </span>
                <div>
                  <h3>GitHub</h3>
                  <p>
                    {github.connected
                      ? `Connected as ${github.login}. Reading branches, PRs, reviews, and checks from your selected projects.`
                      : github.enabled
                        ? 'Reading public branches, PRs, reviews, and checks. Sign in to include private repositories.'
                        : 'See published branches and pull requests alongside work on your Mac.'}
                  </p>
                </div>
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : github.enabled || github.device ? (
                  <button
                    className="secondary-button"
                    onClick={() => void action(() => window.openbranches!.disconnectGitHub())}
                  >
                    {github.device ? 'Cancel sign-in' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={!window.openbranches || !github.configured}
                    onClick={() => void connect()}
                  >
                    Connect GitHub
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              {!github.connected && !github.device && window.openbranches && (
                <div className="connection-options">
                  {github.configured && github.enabled && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void connect()}
                    >
                      Sign in for private repositories
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                  {!github.enabled && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void action(() => window.openbranches!.enablePublicGitHub())}
                    >
                      Track public repositories without signing in
                      <ArrowUpRight size={13} />
                    </button>
                  )}
                  {!github.configured && (
                    <p className="muted-note">
                      GitHub sign-in is awaiting this development build’s app registration. Public
                      repositories can be connected now.
                    </p>
                  )}
                </div>
              )}
              {github.device && (
                <div className="device-signin">
                  <span className="section-kicker">ENTER THIS CODE ON GITHUB</span>
                  <div>
                    <code>{github.device.code}</code>
                    <button
                      className="icon-button"
                      aria-label="Copy sign-in code"
                      onClick={() => void copyCode()}
                    >
                      {copied ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                  <p>
                    Waiting for your approval in the browser. Only repositories you grant access to
                    can be read.
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      void action(() =>
                        window.openbranches!.openExternal(github.device!.verificationUrl),
                      )
                    }
                  >
                    Open GitHub again
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )}
              {(error || github.error) && (
                <p className="connection-error" role="alert">
                  {error || github.error}
                </p>
              )}
              <div className="settings-group-label">Task context</div>
              <CodexConnection status={providers.codex} />
              <div className="settings-group-label">Live branch signals</div>
              <AgentLiveConnections
                statuses={providers.liveAgents}
                focusOnMount={focusSection === 'live-activity'}
              />
              <div className="settings-group-label">Saved tool history</div>
              {(
                providers.agents ?? [
                  {
                    tool: 'claude-code' as const,
                    enabled: false,
                    state: 'not-connected' as const,
                  },
                ]
              ).map((status) => (
                <AgentHistoryConnection key={status.tool} status={status} />
              ))}
            </section>
          </>
        )}
        {section === 'privacy' && (
          <>
            <div className="settings-panel-intro">
              <div className="section-kicker">PRIVACY &amp; FRESHNESS</div>
              <h2>Your work stays under your control.</h2>
              <p>See what OpenBranches reads, where it stays, and when it refreshes.</p>
            </div>
            <div className="settings-privacy-grid">
              <article className="settings-privacy-card">
                <ShieldCheck size={21} />
                <h3>Observe, understand, decide</h3>
                <p>
                  Repository inspection is read-only. OpenBranches never merges, pushes, or removes
                  your branches.
                </p>
              </article>
              <article className="settings-privacy-card">
                <Cloud size={21} />
                <h3>Source freshness</h3>
                <p>
                  Local changes are watched while the app is running. Connected GitHub sources
                  refresh every two minutes. Reviews and checks load in bounded batches. Without a
                  connection, remote references reflect the last fetch you made in Git.
                </p>
              </article>
              <article className="settings-privacy-card">
                <Laptop size={21} />
                <h3>Local by default</h3>
                <p>
                  Project folders, task associations, review choices, and Activity history stay on
                  this Mac unless you explicitly share selected project metadata with a team.
                </p>
              </article>
              <article className="settings-privacy-card">
                <Cable size={21} />
                <h3>Fresh evidence only</h3>
                <p>
                  Live activity appears only from a recent, verified runtime signal tied to the
                  exact checkout. Saved task history never proves that someone is working now.
                </p>
              </article>
              <article className="settings-privacy-card settings-license-card">
                <FileText size={21} />
                <h3>Open-source licenses</h3>
                <p>
                  Versioned notices ship with every Mac build, including the complete Electron and
                  Chromium license set.
                </p>
                <div className="settings-legal-actions">
                  <button
                    className="secondary-button"
                    disabled={!window.openbranches || !!legalBusy}
                    onClick={() => void openLegalDocument('notices')}
                  >
                    {legalBusy === 'notices' && <LoaderCircle size={13} className="spin" />}
                    Third-party notices
                  </button>
                  <button
                    className="text-button"
                    disabled={!window.openbranches || !!legalBusy}
                    onClick={() => void openLegalDocument('chromium')}
                  >
                    {legalBusy === 'chromium' && <LoaderCircle size={13} className="spin" />}
                    Chromium notices
                  </button>
                </div>
                {legalError && (
                  <p className="connection-error" role="alert">
                    {legalError}
                  </p>
                )}
              </article>
            </div>
            <p className="settings-development">OpenBranches is in active development.</p>
          </>
        )}
      </div>
    </div>
  );
}
