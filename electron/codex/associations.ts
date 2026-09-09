import type { Branch, Repository } from '../../src/domain/types';
import type { CodexTask } from './reader';
import { associateTask as associate, linkRepository as link } from '../agents/associations';

export function associateTask(
  repository: Repository,
  branch: Branch,
  task: CodexTask,
  checkedAt: string,
) {
  return associate(repository, branch, { ...task, tool: 'codex' }, checkedAt);
}
export function linkRepository(
  repository: Repository,
  tasks: CodexTask[],
  checkedAt: string,
): Repository {
  return link(
    repository,
    tasks.map((task) => ({ ...task, tool: 'codex' as const })),
    checkedAt,
    'codex',
  );
}
