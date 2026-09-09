import { resolve, isAbsolute } from 'node:path';
import type { Branch, Repository, TaskLink } from '../../src/domain/types';
import type { SavedAgentTask } from './types';
import { toolNames } from '../../src/domain/agents';
import { githubRepository } from '../github/reader';

function context(repository: Repository) {
  return {
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
  if (!sameBranch && !sameDetachedWorktree) return;
  const verified = !branch.detached && sameRepository && sameBranch && sameCommit;
  const commitEvidence =
    task.gitInfo?.sha === branch.local?.sha
      ? 'Saved commit matches the local branch tip.'
      : 'Saved commit matches the remote branch tip.';
  return {
    id: task.id,
    tool: task.tool,
    model: task.model,
    title: task.name?.trim() || 'Untitled ' + toolNames[task.tool] + ' task',
    status: 'unknown', // Saved metadata does not establish a client's current activity.
    association: verified ? 'verified' : 'possible',
    archived: task.archived,
    updatedAt: new Date(task.updatedAt * 1000).toISOString(),
    checkedAt: task.checkedAt ?? checkedAt,
    evidence: verified
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
): Repository {
  const evidence = context(repository);
  const byBranch = new Map<string, SavedAgentTask[]>();
  const byCommit = new Map<string, SavedAgentTask[]>();
  for (const task of tasks) {
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
    branches: repository.branches.map((branch) => ({
      ...branch,
      tasks: [
        ...(branch.tasks ?? []).filter((task) => task.tool !== tool),
        ...(branch.detached
          ? [
              ...new Map(
                commitIds(branch)
                  .flatMap((sha) => byCommit.get(sha) ?? [])
                  .map((task) => [task.id, task]),
              ).values(),
            ]
          : (byBranch.get(branch.name) ?? [])
        )
          .flatMap((task) => {
            const link = matchTask(evidence, branch, task, checkedAt);
            return link ? [link] : [];
          })
          .sort(
            (a, b) =>
              (a.association === 'verified' ? 0 : 1) - (b.association === 'verified' ? 0 : 1) ||
              Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!),
          ),
      ],
    })),
  };
}
