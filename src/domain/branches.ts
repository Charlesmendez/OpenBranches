import type { Branch, IntegrationState, Lifecycle, Recommendation, Repository } from './types';
import { recommendationRevision } from './reviews';
import { idleWork, liveTasks, waitingTasks } from './branchActivity';

export const DAY = 86_400_000;
export const lifecycleLabels: Record<Lifecycle, string> = {
  active: 'Recent & open',
  integrated: 'Integrated',
  quiet: 'Quiet',
  unverified: 'Unverified',
};
export function lifecycleOf(branch: Branch, now = Date.now()): Lifecycle {
  const age = now - new Date(branch.updatedAt).getTime();
  if (
    branch.pullRequest?.state === 'open' ||
    branch.worktrees.some((w) => w.dirty) ||
    liveTasks(branch, now).length ||
    waitingTasks(branch, now).length ||
    age < 14 * DAY
  )
    return 'active';
  const states = Object.values(branch.integration);
  if (states.length && states.every((s) => s === 'integrated')) return 'integrated';
  if (!states.length || states.some((s) => s === 'unknown')) return 'unverified';
  return 'quiet';
}
export function locationOf(branch: Branch): string {
  if (branch.local && branch.remote) return 'Mac + remote';
  if (branch.remote) return 'Remote';
  return 'This Mac';
}
export function titleFromBranch(name: string): string {
  const title = name.replace(/^(codex|feat|feature|fix|chore|agent)\//, '').replace(/[-_]+/g, ' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}
export function groupCounts(branches: Branch[], now = Date.now()): Record<Lifecycle, number> {
  return branches.reduce(
    (counts, branch) => {
      counts[lifecycleOf(branch, now)]++;
      return counts;
    },
    { active: 0, integrated: 0, quiet: 0, unverified: 0 },
  );
}
export function featureBranches(repository: Repository): Branch[] {
  return repository.branches.filter(
    (b) =>
      !repository.targets.some((t) => t.name === b.name && t.sha === (b.local ?? b.remote)?.sha),
  );
}
export function integrationLabel(state: IntegrationState | undefined): string {
  return state === 'integrated' ? 'Integrated' : state === 'pending' ? 'Not in history' : 'Unknown';
}
export function relativeTime(date: string, now = Date.now()): string {
  if (!date || new Date(date).getTime() === 0) return 'Unknown';
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return 'Unknown';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}
export function recommendationsFor(repository: Repository, now = Date.now()): Recommendation[] {
  if (repository.error) return [];
  return featureBranches(repository).flatMap((branch) => {
    const facts: Recommendation[] = [];
    const base = {
      repositoryId: repository.id,
      branchId: branch.id,
      checkedAt: repository.scannedAt,
      revision: recommendationRevision(repository, branch),
    };
    const pending = Object.entries(branch.integration)
      .filter(([, state]) => state === 'pending')
      .map(([name]) => name);
    const age = Math.floor((now - new Date(branch.updatedAt).getTime()) / DAY);
    if (branch.local && !branch.remote && pending.length) {
      facts.push({
        ...base,
        id: `${branch.id}:local-only`,
        category: 'local-only',
        title: 'Work with no tracked remote copy',
        explanation: `${branch.title} has no associated remote reference in this scan. Its current commit is not in ${pending.join(' or ')} history; equivalent squash-merged or rebased changes may still be there.`,
        evidence: [
          'Local branch exists',
          'No associated cached remote reference',
          `Current commit not in ${pending.join(', ')} history`,
        ],
        priority: 'review',
      });
    }
    const idle = idleWork(branch, now);
    if (idle) {
      facts.push({
        ...base,
        id: `${branch.id}:forgotten`,
        category: 'forgotten',
        title: 'Review idle work',
        explanation: `${branch.title} has no observed commit or linked task activity for ${idle.days} days. Its current commit is not in ${pending.join(' or ')} history. Check whether it was paused or integrated through a squash or rebase.`,
        evidence: [
          `Last commit ${age} days ago`,
          `Current commit not in ${pending.join(', ')} history`,
        ],
        priority: 'review',
      });
    }
    const integrated = Object.entries(branch.integration)
      .filter(([, s]) => s === 'integrated')
      .map(([name]) => name);
    if (integrated.length && pending.length) {
      facts.push({
        ...base,
        id: `${branch.id}:integration-gap`,
        category: 'integration-gap',
        title: 'Part of the way there',
        explanation: `${branch.title} has a commit in ${integrated.join(', ')} history that is not in ${pending.join(', ')} history. Review whether the change needs promotion or already exists there in another form.`,
        evidence: [
          `Current commit in ${integrated.join(', ')} history`,
          `Current commit not in ${pending.join(', ')} history`,
        ],
        priority: 'notice',
      });
    }
    return facts;
  });
}
