import { GitBranch, HelpCircle } from 'lucide-react';
import type { Repository, Target } from '../../domain/types';
import { defaultTarget } from '../../domain/integrationTargets';

export function IntegrationTargetNotice({
  repository,
  targets,
  source = 'local',
  partial = false,
  context = 'map',
}: {
  repository: Repository;
  targets: readonly Target[];
  source?: 'local' | 'github';
  partial?: boolean;
  context?: 'map' | 'inventory' | 'inspector';
}) {
  const fallback = defaultTarget(targets);
  if (fallback) {
    const remote = fallback.remote ?? 'remote';
    return (
      <div className="integration-target-note default-target">
        <GitBranch size={14} />
        <span>
          Comparing with <strong>{fallback.name}</strong>, the default branch reported by{' '}
          <code>{remote}/HEAD</code>.
        </span>
      </div>
    );
  }
  if (targets.length) return null;
  const detail =
    source === 'github' && repository.targets.length
      ? 'GitHub target history is not available yet. Local Git history is available in the other view.'
      : source === 'github' && partial
        ? 'No integration target is visible in this incomplete GitHub snapshot yet.'
        : 'Git did not expose develop, dev, main, master, or a remote default branch.';
  const outcome =
    context === 'inventory'
      ? 'Integration columns appear after Git identifies a target.'
      : context === 'inspector'
        ? 'Integration status needs a verified target.'
        : 'Connection lines appear after Git identifies a target.';
  return (
    <div className="integration-target-note missing-target">
      <HelpCircle size={14} />
      <span>
        <strong>No integration target detected.</strong> {detail} Branch activity and locations
        remain available. {outcome}
      </span>
    </div>
  );
}
