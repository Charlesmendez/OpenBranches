import { Radio, Clock3, FilePenLine, UserRound } from 'lucide-react';
import type { Branch } from '../../domain/types';
import { branchActivity, idleWork } from '../../domain/branchActivity';

export function BranchActivity({ branch, now = Date.now() }: { branch: Branch; now?: number }) {
  const activity = branchActivity(branch, now);
  const idle = idleWork(branch, now);
  const Icon =
    activity.kind === 'live' || activity.kind === 'recent'
      ? Radio
      : activity.kind === 'changes'
        ? FilePenLine
        : Clock3;
  const author = branch.pullRequest?.author?.login ?? (branch.local ?? branch.remote)?.author;
  return (
    <div className="branch-activity">
      <span className={`activity-presence ${activity.kind}`} title={activity.detail}>
        <Icon size={12} />
        {activity.label}
      </span>
      {idle && (
        <span
          className="idle-work-flag"
          title={
            idle.unassigned
              ? 'No linked task or open PR was found. This may be intentional; ownership is not established.'
              : 'No recent commit or linked task activity was observed.'
          }
        >
          {idle.unassigned ? 'Unassigned' : 'Idle'} · {idle.days}d
        </span>
      )}
      {author && (
        <span
          className="branch-person"
          title={
            branch.pullRequest?.author ? `PR author: ${author}` : `Last commit author: ${author}`
          }
        >
          <UserRound size={11} />
          {branch.pullRequest?.author ? 'PR: ' : 'Last commit: '}
          {author}
        </span>
      )}
    </div>
  );
}
