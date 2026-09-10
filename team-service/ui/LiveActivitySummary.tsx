import { useMemo } from 'react';
import { ToolIcon } from '../../src/ui/components/AgentBadges';
import { sharedBranchRows, type SharedBranchRow } from '../../src/team/activity';
import type { TeamPage } from '../../src/team/responses';

type ActiveRow = SharedBranchRow & { activity: NonNullable<SharedBranchRow['activity']> };

export function LiveActivitySummary({
  data,
  now,
  onFocus,
}: {
  data: TeamPage;
  now: number;
  onFocus: (row: SharedBranchRow) => void;
}) {
  const rows = useMemo(
    () =>
      sharedBranchRows(data, now)
        .filter((row): row is ActiveRow => !!row.activity)
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            a.person.localeCompare(b.person) ||
            a.branch.name.localeCompare(b.branch.name),
        ),
    [data, now],
  );
  if (!rows.length) return null;
  const shown = rows.slice(0, 6);
  return (
    <section className="shared-activity-rail" aria-labelledby="shared-active-heading">
      <header>
        <span className="activity-beacon" aria-hidden="true">
          <i />
        </span>
        <span>
          <strong id="shared-active-heading">Happening now</strong>
          <small>
            {rows.length} {rows.length === 1 ? 'branch has' : 'branches have'} fresh, verified
            runtime evidence from opted-in Macs
          </small>
        </span>
      </header>
      <div className="shared-active-items">
        {shown.map((row) => (
          <button
            key={row.key}
            className={row.activity.kind}
            onClick={() => onFocus(row)}
            aria-label={`${row.branch.name}, ${row.activity.label}, reported by ${row.person} in ${row.project}`}
          >
            <span className="active-tool-stack" aria-hidden="true">
              {[...new Set(row.activity.tasks.map((task) => task.tool))].map((tool) => (
                <ToolIcon key={tool} tool={tool} />
              ))}
            </span>
            <span>
              <strong>{row.branch.name}</strong>
              <small>
                @{row.person} · {row.project}
              </small>
            </span>
            <em>{row.activity.label}</em>
          </button>
        ))}
      </div>
      {rows.length > shown.length && (
        <small className="active-more">
          +{rows.length - shown.length} more in the branch groups
        </small>
      )}
    </section>
  );
}
