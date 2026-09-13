import {
  ArrowUpRight,
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { UpdateController } from '../hooks/useUpdates';

const checkedLabel = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return `Last checked ${date.toLocaleString()}`;
};

export function UpdateSettings({ updates }: { updates: UpdateController }) {
  const status = updates.status;
  const state = status?.state ?? 'unavailable';
  const version = status?.currentVersion ? `v${status.currentVersion}` : 'Browser preview';
  const release = status?.availableVersion
    ? `v${status.availableVersion}`
    : status?.releaseName || 'the latest version';
  const busy = state === 'checking' || state === 'downloading';

  return (
    <>
      <div className="settings-panel-intro">
        <div className="section-kicker">UPDATES</div>
        <h2>Keep OpenBranches current.</h2>
        <p>
          The signed Mac app checks its public GitHub releases in the background. You stay in
          control of when the app restarts.
        </p>
      </div>
      <section className={`update-card ${state}`} aria-live="polite">
        <div className="update-card-icon" aria-hidden="true">
          {state === 'ready' ? (
            <Download size={23} />
          ) : busy ? (
            <LoaderCircle className="spin" size={23} />
          ) : state === 'error' ? (
            <TriangleAlert size={23} />
          ) : (
            <Check size={23} />
          )}
        </div>
        <div className="update-card-copy">
          <span className="update-version">INSTALLED · {version}</span>
          {state === 'ready' ? (
            <>
              <h3>{release} is ready to install.</h3>
              <p>The download is complete. OpenBranches will reopen on the new version.</p>
            </>
          ) : state === 'downloading' ? (
            <>
              <h3>Downloading the new version…</h3>
              <p>You can keep working. OpenBranches will tell you when it is ready.</p>
            </>
          ) : state === 'checking' ? (
            <>
              <h3>Checking for updates…</h3>
              <p>This usually takes only a moment.</p>
            </>
          ) : state === 'current' ? (
            <>
              <h3>OpenBranches is up to date.</h3>
              <p>{checkedLabel(status?.checkedAt) ?? 'You have the newest public release.'}</p>
            </>
          ) : state === 'error' ? (
            <>
              <h3>The update check did not finish.</h3>
              <p>{status?.error ?? 'Try again when your network connection is available.'}</p>
            </>
          ) : state === 'idle' ? (
            <>
              <h3>Automatic updates are on.</h3>
              <p>OpenBranches checks shortly after launch and then every few hours.</p>
            </>
          ) : (
            <>
              <h3>Updates run in the installed Mac app.</h3>
              <p>This browser or development preview cannot replace the application.</p>
            </>
          )}
          {state === 'ready' && status?.releaseNotes && (
            <details className="update-notes">
              <summary>What changed</summary>
              <div>{status.releaseNotes}</div>
            </details>
          )}
          <div className="update-actions">
            {state === 'ready' ? (
              <button className="primary-button" onClick={() => void updates.install()}>
                <RotateCcw size={14} /> Restart and update
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy || !window.openbranches}
                onClick={() => void updates.check()}
              >
                {busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                {state === 'error' ? 'Try again' : 'Check now'}
              </button>
            )}
            <button
              className="text-button"
              disabled={!window.openbranches}
              onClick={() =>
                void window.openbranches?.openExternal(
                  'https://github.com/Charlesmendez/OpenBranches/releases/latest',
                )
              }
            >
              View latest release <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      </section>
      <div className="update-trust">
        <ShieldCheck size={17} />
        <div>
          <strong>Signed and verified before installation</strong>
          <p>
            Updates come from the public OpenBranches GitHub release and macOS verifies the
            Developer ID signature before replacing the app.
          </p>
        </div>
      </div>
    </>
  );
}
