import { useState } from 'react';
import { Link2 } from 'lucide-react';
import type { TaskLink } from '../../domain/types';
import { relativeTime } from '../../domain/branches';

export function TaskDetails({ tasks, demo }: { tasks: TaskLink[]; demo: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!tasks.length) return null;
  return (
    <section className="inspector-section">
      <h3>Codex {tasks.length === 1 ? 'task' : `tasks · ${tasks.length}`}</h3>
      <div className="task-list">
        {(expanded ? tasks : tasks.slice(0, 3)).map((task) => (
          <div className="task-detail" key={task.id}>
            <Link2 size={17} />
            <div>
              <strong>{task.title}</strong>
              <small>
                {task.association === 'verified'
                  ? 'Branch and commit match'
                  : 'Possible association'}
                {task.archived ? ' · Archived' : ''}
              </small>
              {task.updatedAt && (
                <small>Task updated {relativeTime(task.updatedAt).toLowerCase()}</small>
              )}
              {task.evidence?.length ? (
                <details className="task-evidence">
                  <summary>Why this task appears</summary>
                  <ul>
                    {task.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {task.checkedAt && (
                    <p>
                      Checked {relativeTime(task.checkedAt).toLowerCase()}. Saved metadata can
                      become outdated as work moves.
                    </p>
                  )}
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {tasks.length > 3 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer tasks' : `Show all ${tasks.length} tasks`}
        </button>
      )}
      {!demo && (
        <p className="evidence-note">
          Saved task history. Current activity in Codex is not available.
        </p>
      )}
    </section>
  );
}
