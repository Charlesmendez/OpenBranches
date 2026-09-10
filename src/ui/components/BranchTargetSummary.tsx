import { Check, CircleHelp, Minus } from 'lucide-react';
import type { Branch, IntegrationState, Target } from '../../domain/types';
import { primaryIntegrationTargets } from '../../domain/integrationTargets';

const stateText = (state: IntegrationState | undefined, target: string) =>
  state === 'integrated'
    ? `In ${target}`
    : state === 'pending'
      ? `Not in ${target}`
      : `${target} unknown`;

export function BranchTargetSummary({
  branch,
  targets,
  limit = 2,
}: {
  branch: Branch;
  targets: readonly Target[];
  limit?: number;
}) {
  const shown = primaryIntegrationTargets(targets, limit);
  if (!shown.length)
    return (
      <span
        className="branch-target-summary empty"
        title="Git did not expose an integration target."
      >
        <CircleHelp size={10} /> Target unknown
      </span>
    );
  return (
    <span
      className="branch-target-summary"
      aria-label={`Local Git integration: ${targets
        .map((target) => stateText(branch.integration[target.name], target.name))
        .join(', ')}`}
    >
      {shown.map((target) => {
        const state = branch.integration[target.name] ?? 'unknown';
        const Icon = state === 'integrated' ? Check : state === 'pending' ? Minus : CircleHelp;
        const label = stateText(state, target.name);
        return (
          <span
            key={target.name}
            className={`branch-target-status ${state}`}
            title={`Local Git: ${label}`}
          >
            <Icon size={10} />
            {label}
          </span>
        );
      })}
      {targets.length > shown.length && (
        <span
          className="branch-target-more"
          title={`${targets.length - shown.length} more integration targets; open the branch for details.`}
        >
          +{targets.length - shown.length}
        </span>
      )}
    </span>
  );
}
