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

export function targetHistoryLabel(target: Target): string {
  const source =
    target.source === 'local'
      ? 'Local history'
      : target.source === 'github'
        ? 'GitHub history'
        : 'Cached history';
  return target.role === 'default' ? `Default branch · ${source}` : source;
}
