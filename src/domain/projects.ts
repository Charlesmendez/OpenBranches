import type { Repository } from './types';

export function projectMatches(project: Pick<Repository, 'name' | 'path'>, query: string): boolean {
  const text = `${project.name} ${project.path}`.normalize('NFKC').toLocaleLowerCase();
  return query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .every((term) => text.includes(term));
}
