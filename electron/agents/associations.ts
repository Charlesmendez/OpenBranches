import { resolve, isAbsolute } from 'node:path';
import type { Branch, Repository, TaskLink } from '../../src/domain/types';
import type { SavedAgentTask } from './types';
import { toolNames } from '../../src/domain/agents';
import { githubRepository } from '../../src/github/reader';
import { LIVE_ACTIVITY_TTL } from '../../src/domain/branchActivity';

function context(repository: Repository) {
  return {
    checkoutFresh:
      !repository.error &&
      Number.isFinite(Date.parse(repository.scannedAt)) &&
      Math.abs(Date.now() - Date.parse(repository.scannedAt)) <= 120_000,
    paths: new Set(
      [repository.path, ...repository.worktrees.map((w) => w.path)].map((path) => resolve(path)),
    ),
    remotes: new Set(
      repository.remotes
        .map((remote) => githubRepository(remote.url)?.toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function associateTask(
  repository: Repository,
  branch: Branch,
  task: SavedAgentTask,
  checkedAt: string,
): TaskLink | undefined {
  return matchTask(context(repository), branch, task, checkedAt);
}

function matchTask(
  repository: ReturnType<typeof context>,
  branch: Branch,
  task: SavedAgentTask,
  checkedAt: string,
): TaskLink | undefined {
  if (!isAbsolute(task.cwd)) return;
  const cwd = resolve(task.cwd);
  const sameRepository = repository.paths.has(cwd);
  const origin = task.gitInfo?.originUrl && githubRepository(task.gitInfo.originUrl)?.toLowerCase();
  const sameRemote = !!origin && repository.remotes.has(origin);
  if (!sameRepository && !sameRemote) return;
  const recordedBranch = task.gitInfo?.branch?.replace(/^refs\/heads\//, '');
  const sameBranch = !!recordedBranch && recordedBranch === branch.name;
  const sameCommit = !!task.gitInfo?.sha && commitIds(branch).includes(task.gitInfo.sha);
  const sameDetachedWorktree =
    branch.detached && sameCommit && branch.worktrees.some((w) => resolve(w.path) === cwd);
  const liveCheckout =
    repository.checkoutFresh &&
    task.runtime &&
    Date.parse(task.runtime.checkedAt) >= Date.now() - LIVE_ACTIVITY_TTL &&
    Date.parse(task.runtime.checkedAt) <= Date.now() + 60_000 &&
    !branch.detached &&
    branch.worktrees.some(
      (tree) =>
        tree.available &&
        resolve(tree.path) === cwd &&
        tree.branch?.replace(/^refs\/heads\//, '') === branch.name &&
        tree.head === branch.local?.sha,
    );
  if (!sameBranch && !sameDetachedWorktree && !liveCheckout) return;
  const verified =
    !!liveCheckout || (!branch.detached && sameRepository && sameBranch && sameCommit);
  const commitEvidence =
    task.gitInfo?.sha === branch.local?.sha
      ? 'Saved commit matches the local branch tip.'
      : 'Saved commit matches the remote branch tip.';
  return {
    id: task.id,
    tool: task.tool,
    model: task.model,
    title: task.name?.trim() || 'Untitled ' + toolNames[task.tool] + ' task',
    status:
      liveCheckout && task.runtime
        ? task.runtime.state === 'active'
          ? 'active'
          : 'idle'
        : 'unknown',
    ...(liveCheckout && task.runtime
      ? { activitySource: task.runtime.source, waiting: task.runtime.state === 'waiting' }
      : {}),
    association: verified ? 'verified' : 'possible',
    archived: task.archived,
    updatedAt: new Date(task.updatedAt * 1000).toISOString(),
    checkedAt: task.runtime?.checkedAt ?? task.checkedAt ?? checkedAt,
    evidence: liveCheckout
      ? [
          task.runtime?.source === 'codex-runtime'
            ? 'Codex runtime status read from the running local daemon.'
            : `${toolNames[task.tool]} activity received from its opted-in local hook.`,
          'Task folder matches this branch’s current checkout.',
        ]
      : verified
        ? [
            'Saved task folder belongs to this repository.',
            'Saved branch name matches.',
            commitEvidence,
          ]
        : sameDetachedWorktree
          ? [
              'Saved task folder and commit match this detached worktree. Branch ownership is unconfirmed.',
            ]
          : [
              sameRepository
                ? 'Saved task folder belongs to this repository.'
                : 'Saved GitHub repository matches; the task folder is not a known local worktree.',
              'Saved branch name matches.',
              sameCommit
                ? commitEvidence
                : 'The branch has changed or its saved commit is unavailable.',
            ],
  };
}

function commitIds(branch: Branch): string[] {
  return [
    branch.local?.sha,
    branch.remote?.sha,
    ...(branch.detached ? branch.worktrees.map((w) => w.head) : []),
  ].filter((sha): sha is string => !!sha);
}

export function linkRepository(
  repository: Repository,
  tasks: SavedAgentTask[],
  checkedAt: string,
  tool: SavedAgentTask['tool'],
  options: { merge?: boolean } = {},
): Repository {
  const evidence = context(repository);
  const byBranch = new Map<string, SavedAgentTask[]>();
  const byCommit = new Map<string, SavedAgentTask[]>();
  const liveByCwd = new Map<string, SavedAgentTask[]>();
  for (const task of tasks) {
    if (task.runtime) {
      const group = liveByCwd.get(resolve(task.cwd)) ?? [];
      group.push(task);
      liveByCwd.set(resolve(task.cwd), group);
    }
    const name = task.gitInfo?.branch?.replace(/^refs\/heads\//, '');
    if (name) {
      const group = byBranch.get(name) ?? [];
      group.push(task);
      byBranch.set(name, group);
    }
    if (task.gitInfo?.sha) {
      const group = byCommit.get(task.gitInfo.sha) ?? [];
      group.push(task);
      byCommit.set(task.gitInfo.sha, group);
    }
  }
  return {
    ...repository,
    branches: repository.branches.map((branch) => {
      const existing = branch.tasks ?? [];
      const linked = (
        branch.detached
          ? [
              ...new Map(
                commitIds(branch)
                  .flatMap((sha) => byCommit.get(sha) ?? [])
                  .map((task) => [task.id, task]),
              ).values(),
            ]
          : [
              ...new Map(
                [
                  ...(byBranch.get(branch.name) ?? []),
                  ...branch.worktrees.flatMap((tree) => liveByCwd.get(resolve(tree.path)) ?? []),
                ].map((task) => [task.id, task]),
              ).values(),
            ]
      ).flatMap((task) => {
        const link = matchTask(evidence, branch, task, checkedAt);
        if (!link) return [];
        const prior = existing.find(
          (candidate) => candidate.tool === link.tool && candidate.id === link.id,
        );
        return [
          prior && options.merge
            ? {
                ...prior,
                ...link,
                title: task.name?.trim() ? link.title : prior.title,
                model: link.model ?? prior.model,
              }
            : link,
        ];
      });
      const linkedKeys = new Set(linked.map((task) => `${task.tool}:${task.id}`));
      return {
        ...branch,
        tasks: [
          ...existing.filter(
            (task) =>
              (options.merge || task.tool !== tool) && !linkedKeys.has(`${task.tool}:${task.id}`),
          ),
          ...linked,
        ].sort(
          (a, b) =>
            (a.association === 'verified' ? 0 : 1) - (b.association === 'verified' ? 0 : 1) ||
            Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''),
        ),
      };
    }),
  };
}
