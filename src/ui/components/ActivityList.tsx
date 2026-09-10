import {
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  PanelsTopLeft,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityEvent } from '../../domain/types';
import { groupActivity, type ActivityItem } from '../../domain/activity';
import { relativeTime } from '../../domain/branches';
import './activity.css';

const activityPresentation: Record<ActivityEvent['kind'], { label: string; icon: LucideIcon }> = {
  commit: { label: 'Commit', icon: GitCommitHorizontal },
  branch: { label: 'Branch', icon: GitBranch },
  worktree: { label: 'Worktree', icon: PanelsTopLeft },
  integration: { label: 'Integration', icon: GitMerge },
};

function ActivityRow({
  item,
  now,
  timeline,
  onSelect,
}: {
  item: ActivityItem;
  now: number;
  timeline: boolean;
  onSelect: (repositoryId: string, branchId?: string) => void;
}) {
  const { event, repositoryName } = item;
  const presentation = activityPresentation[event.kind];
  const Icon = presentation.icon;
  return (
    <button
      className={`activity-row ${timeline ? 'timeline' : 'compact'}`}
      onClick={() => onSelect(event.repositoryId, event.branchId)}
    >
      <span className="activity-time">{relativeTime(event.at, now)}</span>
      <span className={`activity-icon ${event.kind}`} aria-hidden="true">
        <Icon size={timeline ? 18 : 16} />
      </span>
      {timeline ? (
        <>
          <span className="activity-copy">
            <strong>{event.title}</strong>
            <small>{event.detail}</small>
          </span>
          <span className="activity-meta">
            <span className={`activity-kind ${event.kind}`}>{presentation.label}</span>
            <span>{repositoryName}</span>
          </span>
        </>
      ) : (
        <>
          <strong className="activity-compact-title">{event.title}</strong>
          <span className="activity-compact-detail">
            <span>{event.detail}</span>
            <i />
            <span>{repositoryName}</span>
          </span>
        </>
      )}
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}

export function ActivityList({
  items,
  onSelect,
  now,
  limit,
  grouped = false,
}: {
  items: ActivityItem[];
  onSelect: (repositoryId: string, branchId?: string) => void;
  now: number;
  limit?: number;
  grouped?: boolean;
}) {
  const shown = limit === undefined ? items : items.slice(0, limit);
  if (!shown.length)
    return (
      <div className="quiet-activity">
        Changes will appear here as you work. Your first scan establishes the starting point.
      </div>
    );
  if (!grouped)
    return (
      <div className="activity-list compact">
        {shown.map((item) => (
          <ActivityRow
            key={item.event.id}
            item={item}
            now={now}
            timeline={false}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  return (
    <div className="activity-timeline">
      {groupActivity(shown, now).map((group) => (
        <section key={group.label} className="activity-day" aria-label={group.label}>
          <header>
            <h2>{group.label}</h2>
            <span>{group.items.length}</span>
          </header>
          <div className="activity-list">
            {group.items.map((item) => (
              <ActivityRow key={item.event.id} item={item} now={now} timeline onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
