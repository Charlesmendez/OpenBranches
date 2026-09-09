import { Check, Cloud, Laptop } from 'lucide-react';
import { useState } from 'react';
import type { Branch, Repository } from '../../domain/types';
import { relativeTime } from '../../domain/branches';

export function IntegrationEvidence({
  branch,
  repository,
}: {
  branch: Branch;
  repository: Repository;
}) {
  const published = branch.publishedHistory;
  const [choice, setChoice] = useState(branch.local || !published ? 'local' : 'github');
  const github = !!published && (choice === 'github' || !branch.local);
  const ref = github ? branch.remote : (branch.local ?? branch.remote);
  const targets = github
    ? published.targets
    : repository.targets.map((target) => ({
        ...target,
        state: branch.integration[target.name] ?? 'unknown',
        checkedAt: repository.scannedAt,
      }));
  const unknown = targets.filter((target) => target.state === 'unknown').length;
  const differs = branch.local && published && branch.local.sha !== published.branchSha;
  return (
    <section className="inspector-section" aria-label="Integration evidence">
      <h3>Integration evidence</h3>
      {published && branch.local ? (
        <div className="history-sources" role="group" aria-label="Choose history source">
          <button aria-pressed={!github} onClick={() => setChoice('local')}>
            <Laptop size={13} /> This Mac
          </button>
          <button aria-pressed={github} onClick={() => setChoice('github')}>
            <Cloud size={13} /> GitHub
          </button>
        </div>
      ) : (
        <p className="history-caption">
          {github ? 'GitHub history' : branch.local ? 'History on this Mac' : 'Cached Git history'}
        </p>
      )}
      <div className="history-commit">
        <span>
          {github ? 'Published commit' : branch.local ? 'Local commit' : 'Cached remote commit'}
        </span>
        <code title={ref?.sha}>{ref?.sha.slice(0, 7) ?? 'Unknown'}</code>
      </div>
      <div className="integration-path">
        {targets.map((target) => (
          <div
            key={target.name}
            className={`path-step ${target.state === 'integrated' ? 'complete' : ''} ${target.name === 'master' || target.name === 'main' ? 'stable' : ''}`}
          >
            <span className="step-marker">
              {target.state === 'integrated' && <Check size={12} />}
            </span>
            <div>
              <strong>
                {github ? `${published.remoteName}/` : ''}
                {target.name}
              </strong>
              <small>
                {target.state === 'integrated'
                  ? 'Commit is in this history'
                  : target.state === 'pending'
                    ? 'Commit not in this history'
                    : target.checkedAt && github
                      ? 'Could not be checked'
                      : github
                        ? 'Waiting for a history check'
                        : 'Needs more evidence'}
              </small>
              <small className="history-target" title={target.sha}>
                {github
                  ? 'GitHub'
                  : target.source === 'local'
                    ? 'This Mac'
                    : target.source === 'github'
                      ? 'GitHub target'
                      : 'Cached remote target'}{' '}
                · {target.sha.slice(0, 7)}
              </small>
            </div>
          </div>
        ))}
        {!targets.length && (
          <p className="muted-note">
            {github && published.partial
              ? 'No integration branch observed yet. This GitHub snapshot is incomplete.'
              : `No standard integration branch found${github ? ' on this GitHub remote' : ''}.`}
          </p>
        )}
      </div>
      {github && (
        <p className="history-freshness">
          {published.unavailable ? 'GitHub unavailable · saved snapshot' : 'GitHub checked'} ·{' '}
          {relativeTime(published.checkedAt)}
          {unknown > 0 && ` · ${unknown} ${unknown === 1 ? 'check' : 'checks'} pending`}
        </p>
      )}
      {github && unknown > 0 && (
        <p className="evidence-note">
          {published.error ??
            'History loads in batches and continues with each refresh, subject to GitHub’s limits.'}
        </p>
      )}
      <p className="evidence-note">
        Each target is checked independently. Squashed or rebased changes may need PR verification.
      </p>
      {differs && (
        <div className="source-error inline-evidence">
          <span>
            {github
              ? 'Your Mac has a different commit. This result describes the published copy.'
              : 'Your published copy has a different commit. Switch to GitHub to check its history.'}
          </span>
        </div>
      )}
    </section>
  );
}
