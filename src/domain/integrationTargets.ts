import type { Target } from './types';

export const standardIntegrationNames = ['develop', 'dev', 'main', 'master'] as const;

export function integrationTargetNames(
  targets?: readonly Pick<Target, 'name' | 'role'>[],
): string[] {
  const declaredDefault = targets?.some((target) => target.role === 'default');
  const preferred = declaredDefault
    ? (targets ?? []).map((target) => target.name).filter(Boolean)
    : [];
  return [...new Set(preferred.length ? preferred : standardIntegrationNames)];
}

export function defaultTarget(targets: readonly Target[]): Target | undefined {
  return targets.find((target) => target.role === 'default');
}

/** Keep compact summaries useful when a repository exposes every conventional
 * target: show one development target and one stable target before aliases. */
export function primaryIntegrationTargets(targets: readonly Target[], limit = 2): Target[] {
  if (limit <= 0) return [];
  if (targets.length <= limit) return [...targets];
  const selected: Target[] = [];
  for (const names of [
    ['develop', 'dev'],
    ['main', 'master'],
  ]) {
    const target = targets.find((candidate) => names.includes(candidate.name));
    if (target && !selected.includes(target)) selected.push(target);
  }
  for (const target of targets) {
    if (selected.length >= limit) break;
    if (!selected.includes(target)) selected.push(target);
  }
  return selected.slice(0, limit);
}

export function targetHistoryLabel(target: Target): string {
  const source =
    target.source === 'local'
      ? 'History on this Mac'
      : target.source === 'github'
        ? 'History checked on GitHub'
        : 'Cached remote history on this Mac';
  return target.role === 'default' ? `Default branch · ${source}` : source;
}
