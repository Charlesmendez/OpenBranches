import { Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import { relativeTime } from '../../domain/branches';
import { toolNames } from '../../domain/agents';
import type { AgentHandoff } from '../../domain/types';
import { ToolIcon } from './AgentBadges';

export function HandoffActivity({
  handoffs,
  repositoryId,
  now,
}: {
  handoffs: AgentHandoff[];
  repositoryId: string | null;
  now: number;
}) {
  const scoped = handoffs.filter(
    (handoff) => !repositoryId || handoff.repositoryId === repositoryId,
  );
  const relevant = scoped.slice(0, 4);
  if (!relevant.length) return null;
  const active = scoped.filter(
    (handoff) => handoff.state === 'queued' || handoff.state === 'running',
  ).length;
  return (
    <section className="handoff-activity" aria-label="Agent handoffs">
      <header>
        <div>
          <strong>
            {active
              ? `${active} agent ${active === 1 ? 'task' : 'tasks'} in progress`
              : 'Recent agent work'}
          </strong>
          <span>
            Each task stays attached to every branch it received.
            {scoped.length > relevant.length
              ? ` Showing the ${relevant.length} most recent of ${scoped.length}.`
              : ''}
          </span>
        </div>
      </header>
      <div>
        {relevant.map((handoff) => (
          <details key={handoff.id} className={`handoff-activity-row ${handoff.state}`}>
            <summary>
              <span className="provider-mark">
                <ToolIcon tool={handoff.provider} />
              </span>
              <span>
                <strong>
                  {toolNames[handoff.provider]} · {handoff.repositoryName}
                </strong>
                <small>
                  {handoff.branchIds.length}{' '}
                  {handoff.branchIds.length === 1 ? 'branch' : 'branches'} ·{' '}
                  {relativeTime(handoff.updatedAt, now)}
                </small>
              </span>
              <span className="handoff-state-label">
                {handoff.state === 'queued' || handoff.state === 'running' ? (
                  <LoaderCircle className="spin" size={13} />
                ) : handoff.state === 'completed' ? (
                  <Check size={13} />
                ) : (
                  <TriangleAlert size={13} />
                )}
                {handoff.state === 'queued'
                  ? 'Queued'
                  : handoff.state === 'running'
                    ? 'Investigating'
                    : handoff.state === 'completed'
                      ? 'Proposal ready'
                      : 'Needs retry'}
              </span>
            </summary>
            <div className="handoff-activity-detail">
              <div className="handoff-branch-list">
                {handoff.branchNames.map((branch) => (
                  <code key={branch}>{branch}</code>
                ))}
              </div>
              {handoff.result && <pre>{handoff.result}</pre>}
              {handoff.error && <p>{handoff.error}</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
