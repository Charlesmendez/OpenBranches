import { ArrowUpRight, Cloud, GitBranch, Laptop, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { Branch, Repository, Worktree } from '../../domain/types';
import { relativeTime, shortPath } from '../../domain/branches';
import { remoteDestinationLabel, remoteEvidenceLabel, remoteIdentity } from '../../domain/remotes';
import { liveTasks, waitingTasks } from '../../domain/branchActivity';
import { knownTool, toolNames } from '../../domain/agents';
import { useClock } from '../hooks/useClock';

const INITIAL_COPY_LIMIT = 4;

const pathKey = (value: string) => value.replace(/\/+$/, '');

function copyLabel(tree: Worktree, repository: Repository) {
  if (tree.detached) return 'Detached checkout';
  return pathKey(tree.path) === pathKey(repository.path) ? 'Primary checkout' : 'Linked worktree';
}

type CopyActivity = { label: string; tone: 'blue' | 'violet' };
const activityRank = (activity?: CopyActivity) =>
  activity?.tone === 'blue' ? 2 : activity ? 1 : 0;

function activityByWorktree(branch: Branch, now: number) {
  const grouped = new Map<string, { tools: Set<string>; waiting: boolean }>();
  for (const [tasks, waiting] of [
    [waitingTasks(branch, now), true],
    [liveTasks(branch, now), false],
  ] as const)
    for (const task of tasks) {
      if (!task.worktreePath) continue;
      const value = grouped.get(task.worktreePath) ?? { tools: new Set<string>(), waiting };
      value.tools.add(toolNames[knownTool(task.tool)]);
      if (!waiting) value.waiting = false;
      grouped.set(task.worktreePath, value);
    }
  return new Map<string, CopyActivity>(
    [...grouped].map(([path, value]) => [
      path,
      {
        label: `${[...value.tools].join(' + ')} ${value.waiting ? 'waiting' : 'working'}`,
        tone: value.waiting ? 'violet' : 'blue',
      },
    ]),
  );
}

function copyStates(tree: Worktree, activity?: CopyActivity) {
  const states: { label: string; tone?: 'blue' | 'violet' | 'amber' }[] = [];
  if (activity) states.push(activity);
  if (!tree.available) states.push({ label: 'Missing from disk', tone: 'amber' });
  else if (tree.dirty === true)
    states.push({
      label:
        tree.changedFiles === null
          ? 'Uncommitted changes'
          : `${tree.changedFiles} changed ${tree.changedFiles === 1 ? 'file' : 'files'}`,
      tone: 'amber',
    });
  else if (tree.dirty === null) states.push({ label: 'Changes not checked', tone: 'amber' });
  else states.push({ label: 'Clean' });
  if (tree.locked) states.push({ label: 'Locked' });
  if (tree.prunable) states.push({ label: 'Prunable', tone: 'amber' });
  return states;
}

function copyNote(tree: Worktree) {
  return [
    tree.statusNote,
    tree.locked && tree.locked !== 'Locked' ? `Lock: ${tree.locked}` : undefined,
    tree.prunable && tree.prunable !== 'Missing worktree'
      ? `Prunable: ${tree.prunable}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function WorktreeLocations({
  branch,
  repository,
  demo,
  onError,
}: {
  branch: Branch;
  repository: Repository;
  demo: boolean;
  onError: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const now = useClock();
  const activity = activityByWorktree(branch, now);
  const copies = [...branch.worktrees].sort(
    (a, b) =>
      activityRank(activity.get(b.path)) - activityRank(activity.get(a.path)) ||
      Number(b.available) - Number(a.available) ||
      Number(b.dirty === true) - Number(a.dirty === true) ||
      a.path.localeCompare(b.path),
  );
  const visible = expanded ? copies : copies.slice(0, INITIAL_COPY_LIMIT);
  const hidden = copies.length - visible.length;
  const reveal = async (path?: string) => {
    if (demo) {
      onError('This is a fictional demo path. Connect a repository to reveal its worktrees.');
      return;
    }
    try {
      await window.openbranches?.revealWorktree(repository.id, branch.id, path);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const remote = remoteIdentity(repository, branch);
  const remoteNote =
    branch.remote?.presence === 'missing'
      ? 'Not listed on GitHub at the last successful check. This cached reference may have been deleted.'
      : branch.remote?.source === 'github'
        ? `GitHub checked ${relativeTime(branch.remote.checkedAt ?? '').toLowerCase()}${repository.github?.error ? ' · source unavailable' : ''}`
        : 'Cached locally · GitHub presence has not been checked';
  const localCount = copies.filter((copy) => copy.available).length;
  const missingCount = copies.length - localCount;
  const summary = [
    localCount
      ? `${localCount} local ${localCount === 1 ? 'checkout' : 'checkouts'}`
      : branch.local
        ? 'Local ref'
        : '',
    missingCount ? `${missingCount} missing` : '',
    remote ? remoteEvidenceLabel(remote) : '',
  ]
    .filter(Boolean)
    .join(' + ');

  return (
    <section className="inspector-section worktree-locations" aria-label="Branch locations">
      <div className="location-heading">
        <h3>Where it lives</h3>
        <span>{summary || 'Location unavailable'}</span>
      </div>
      {visible.map((tree) => {
        const note = copyNote(tree);
        return (
          <div className="location-detail worktree-copy" key={tree.path}>
            {tree.available ? <Laptop size={18} /> : <TriangleAlert size={18} />}
            <div>
              <strong>{copyLabel(tree, repository)}</strong>
              <code title={tree.path}>{shortPath(tree.path)}</code>
              <div className="worktree-copy-meta">
                {copyStates(tree, activity.get(tree.path)).map((state) => (
                  <span className={state.tone ?? ''} key={state.label}>
                    {state.label}
                  </span>
                ))}
                {tree.head && <span title={tree.head}>Commit {tree.head.slice(0, 7)}</span>}
              </div>
              {note && <small>{note}</small>}
            </div>
            {tree.available && (
              <button
                className="text-icon"
                title={`Reveal ${shortPath(tree.path)}`}
                aria-label={`Reveal worktree ${shortPath(tree.path)}`}
                onClick={() => void reveal(tree.path)}
              >
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <button className="location-more" aria-expanded={false} onClick={() => setExpanded(true)}>
          Show {hidden} more {hidden === 1 ? 'worktree' : 'worktrees'}
        </button>
      )}
      {expanded && copies.length > INITIAL_COPY_LIMIT && (
        <button className="location-more" aria-expanded={true} onClick={() => setExpanded(false)}>
          Show fewer worktrees
        </button>
      )}
      {branch.local && !copies.length && (
        <div className="location-detail worktree-copy">
          <GitBranch size={18} />
          <div>
            <strong>Local branch ref · not checked out</strong>
            <code title={repository.path}>{shortPath(repository.path)}</code>
            <small>The branch is stored in this repository. No worktree currently uses it.</small>
          </div>
          <button
            className="text-icon"
            title="Reveal repository folder"
            aria-label="Reveal repository folder"
            onClick={() => void reveal()}
          >
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {branch.remote && remote && (
        <div className="location-detail remote-copy">
          <Cloud size={18} />
          <div>
            <strong>{remoteEvidenceLabel(remote)}</strong>
            <code title={remote.url}>{remoteDestinationLabel(remote)}</code>
            <small>
              Branch ref: {remote.name}/{branch.remote.name}
            </small>
            <small>{demo ? 'Sample remote state' : remoteNote}</small>
            {branch.local && branch.local.sha !== branch.remote.sha && (
              <small>
                Remote commit {branch.remote.sha.slice(0, 7)}
                {Object.entries(branch.remoteIntegration ?? {})
                  .filter(([, state]) => state === 'integrated')
                  .map(([target]) => ` · in locally observed ${target} history`)
                  .join('')}
              </small>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
