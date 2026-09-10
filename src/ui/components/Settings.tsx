import { AgentHistoryConnection } from './AgentHistoryConnection';
import { AgentLiveConnections } from './AgentLiveConnections';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, Check, Cloud, Copy, Laptop, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { GitHubStatus, Repository } from '../../domain/types';
import { useProviders } from '../hooks/useProviders';
import { CodexConnection } from './CodexConnection';
import { GitSetup } from './GitSetup';
import type { GitSetupController } from '../hooks/useGit';
import { MonitoredProjects } from './MonitoredProjects';
import { ProjectDiscovery } from './ProjectDiscovery';
const TeamConnectionsPanel = lazy(() =>
  import('./TeamConnections').then((module) => ({ default: module.TeamConnectionsPanel })),
);

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
  focusSection?: 'live-activity';
}) {
  const providers = useProviders();
  const [github, setGitHub] = useState<GitHubStatus>(providers.github);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setGitHub(providers.github), [providers.github]);
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
  return (
    <div className="settings-content">
      <ProjectDiscovery key={String(demo)} demo={demo} />
      <MonitoredProjects
        repositories={repositories}
        demo={demo}
        onRemove={onRemove}
        onAdd={onAdd}
        onLive={onLive}
      />
      {!demo && (
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
      <section className="settings-section">
        <div className="section-kicker">
          <span>CONNECTIONS</span>
        </div>
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
              <button className="secondary-button" disabled={busy} onClick={() => void connect()}>
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
              Waiting for your approval in the browser. Only repositories you grant access to can be
              read.
            </p>
            <button
              className="text-button"
              onClick={() =>
                void action(() => window.openbranches!.openExternal(github.device!.verificationUrl))
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
        <CodexConnection status={providers.codex} />
        <AgentLiveConnections
          statuses={providers.liveAgents}
          focusOnMount={focusSection === 'live-activity'}
        />
        {(
          providers.agents ?? [
            { tool: 'claude-code' as const, enabled: false, state: 'not-connected' as const },
          ]
        ).map((status) => (
          <AgentHistoryConnection key={status.tool} status={status} />
        ))}
      </section>
      <section className="settings-section">
        <div className="section-kicker">
          <span>YOUR WORKSPACE</span>
        </div>
        <div className="settings-row">
          <span className="settings-icon">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h3>Observe, understand, decide</h3>
            <p>
              Repository inspection is read-only. OpenBranches never merges, pushes, or removes your
              branches.
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>Source freshness</h3>
            <p>
              Local changes are watched while the app is running. Connected GitHub sources refresh
              every two minutes. Reviews and checks load in bounded batches and can take longer in
              larger workspaces. Without a connection, remote references reflect the last fetch you
              made in Git.
            </p>
          </div>
        </div>
      </section>
      <p className="settings-development">
        OpenBranches is in active development. Live activity appears only from a fresh, verified
        local runtime signal.
      </p>
    </div>
  );
}
