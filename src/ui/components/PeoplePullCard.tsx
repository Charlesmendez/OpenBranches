import { taskKey } from '../../domain/agents';
import { useState } from 'react';
import { ArrowUpRight, ChevronRight, CircleAlert, Clock3, Eye, GitPullRequest } from 'lucide-react';
import {
  pullAttentionCues,
  pullSourceStale,
  type PullAttentionKind,
  type PullWork,
} from '../../domain/collaboration';
import { relativeTime } from '../../domain/branches';
import { AgentBadges } from './AgentBadges';
import { PullPeople } from './PullPeople';
import { PullSignals } from './PullSignals';

const cueIcons: Record<PullAttentionKind, typeof CircleAlert> = {
  'failed-checks': CircleAlert,
  'review-requested': Eye,
  'quiet-draft': Clock3,
};

export function PeoplePullCard({
  work,
  demo,
  now,
  onSelect,
}: {
  work: PullWork;
  demo: boolean;
  now: number;
  onSelect: (repositoryId: string, branchId: string) => void;
}) {
  const [message, setMessage] = useState('');
  const pull = work.pull;
  const stale = !demo && pullSourceStale(pull, now);
  const cues = pullAttentionCues(pull, now);
  const primaryCue = cues[0]?.kind;
  const open = async () => {
    if (demo) {
      setMessage('This pull request is part of the fictional demo.');
      return;
    }
    if (!window.openbranches) {
      setMessage('Open this PR from the OpenBranches desktop app.');
      return;
    }
    try {
      await window.openbranches.openExternal(pull.url);
    } catch {
      setMessage('Could not open GitHub. Please try again.');
    }
  };
  const tasks = [
    ...new Map(
      work.links.flatMap(({ branch }) =>
        (branch.tasks ?? []).map((task) => [taskKey(task), task] as const),
      ),
    ).values(),
  ];
  return (
    <article
      className={`people-pull ${stale ? 'stale ' : ''}${primaryCue ? `cue-${primaryCue}` : ''}`}
    >
      <div className="people-pull-heading">
        <span
          className={
            'pull-state ' + (pull.state === 'open' ? (pull.draft ? 'draft' : 'open') : pull.state)
          }
        >
          <GitPullRequest size={15} />
          {pull.state === 'open'
            ? pull.draft
              ? 'Draft'
              : 'Open PR'
            : pull.state === 'merged'
              ? 'Merged'
              : 'Closed'}
        </span>
        <span className="people-pull-number">
          {pull.repository} <b>#{pull.number}</b>
        </span>
        <span className="people-updated">Updated {relativeTime(pull.updatedAt).toLowerCase()}</span>
      </div>
      <h3>{pull.title}</h3>
      {cues.length > 0 && (
        <div className="people-pull-cues" aria-label="Why this pull request needs attention">
          {cues.map((cue) => {
            const Icon = cueIcons[cue.kind];
            return (
              <span key={cue.kind} className={cue.kind}>
                <Icon size={13} />
                <strong>{cue.label}</strong>
                <small>{cue.detail}</small>
              </span>
            );
          })}
        </div>
      )}
      <div className="people-branch">
        <code>{pull.headName}</code>
        <span>→</span>
        <code>{pull.base}</code>
      </div>
      <PullPeople pull={pull} />
      <div className="people-pull-bottom">
        <AgentBadges branch={{ tasks }} compact />
        <span className="pull-observation">
          {demo
            ? 'Sample GitHub data'
            : (stale ? 'Saved GitHub snapshot' : 'GitHub') +
              ' · ' +
              (pull.observedAt
                ? 'checked ' + relativeTime(pull.observedAt).toLowerCase()
                : 'not checked')}
        </span>
        <div className="people-pull-actions">
          {work.links.length > 0 && (
            <button
              className="text-button"
              onClick={() => onSelect(work.links[0].repositoryId, work.links[0].branchId)}
            >
              Inspect branch
              <ChevronRight size={13} />
            </button>
          )}
          <button className="text-button" onClick={() => void open()}>
            View PR
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      {(pull.state === 'open' || pull.signals) && (
        <PullSignals
          headSha={pull.headSha}
          signals={pull.signals}
          demo={demo}
          demoNow={now}
          open={pull.state === 'open'}
          unavailable={stale}
        />
      )}
      {pull.retained && (
        <p className="muted-note">
          Not seen in the latest partial listing. This is its last recorded PR state.
        </p>
      )}
      {message && (
        <p className="muted-note" role="status">
          {message}
        </p>
      )}
    </article>
  );
}
