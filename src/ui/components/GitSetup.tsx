import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  GitBranch,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import type { GitSetupController } from '../hooks/useGit';

export function GitSetup({
  git,
  compact = false,
  onDemo,
}: {
  git: GitSetupController;
  compact?: boolean;
  onDemo?: () => void;
}) {
  const { status, checking, installing, requested, error } = git;
  if (!status || status.state === 'ready') return null;
  const initial = status.state === 'checking';
  const Heading = compact ? 'h2' : 'h1';
  const title = initial
    ? 'Getting your Mac ready.'
    : status.state === 'missing'
      ? 'One small step. Then your whole workspace.'
      : status.state === 'unsupported'
        ? 'Your Git needs an update.'
        : 'Let’s get Git working again.';
  return (
    <section
      className={`git-setup ${compact ? 'compact' : ''}`}
      aria-label="Git setup"
      aria-busy={initial || checking || installing}
    >
      <div className="setup-symbol" aria-hidden="true">
        {initial ? <LoaderCircle size={26} className="spin" /> : <GitBranch size={26} />}
      </div>
      <div className="section-kicker">{initial ? 'CHECKING THIS MAC' : 'SET UP ONCE'}</div>
      <Heading id={compact ? undefined : 'git-setup-title'}>{title}</Heading>
      <p className="setup-description">
        {initial
          ? 'Looking for the Git installation that reads your project history.'
          : status.message}
      </p>
      {(initial || checking || installing) && (
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {installing ? 'Opening Apple’s installer.' : 'Checking this Mac for Git.'}
        </p>
      )}
      {!initial && (
        <>
          {status.installAvailable && (
            <ol className="setup-steps">
              <li>
                <span>{requested ? <Check size={13} /> : '1'}</span>
                <div>
                  <strong>Open Apple’s installer</strong>
                  <p>A macOS window will guide you through the download.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Choose your projects</strong>
                  <p>We’ll detect Git when setup finishes. No terminal needed.</p>
                </div>
              </li>
            </ol>
          )}
          {requested && status.installAvailable && (
            <p className="setup-progress" role="status" aria-live="polite" aria-atomic="true">
              <LoaderCircle size={14} className="spin" aria-hidden="true" />
              Finish installation in Apple’s window. You can explore the demo while it runs.
            </p>
          )}
          <div className="setup-actions">
            {status.installAvailable && (
              <button
                className={requested ? 'secondary-button' : 'primary-button'}
                disabled={installing || checking}
                onClick={() => void git.install()}
              >
                {installing ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                {requested ? 'Open installer again' : 'Install Apple’s tools'}
              </button>
            )}
            <button
              className={
                requested || !status.installAvailable ? 'primary-button' : 'secondary-button'
              }
              disabled={checking || installing}
              onClick={() => void git.recheck()}
            >
              <RefreshCw size={15} className={checking ? 'spin' : ''} aria-hidden="true" />
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <button className="text-button setup-guide" onClick={() => void git.guide()}>
            Apple’s setup guide
            <ArrowUpRight size={13} />
          </button>
        </>
      )}
      {error && (
        <p className="connection-error" role="alert">
          {error}
        </p>
      )}
      {onDemo && (
        <button className="text-button setup-demo" onClick={onDemo}>
          Explore the demo
          <ArrowRight size={14} />
        </button>
      )}
    </section>
  );
}
