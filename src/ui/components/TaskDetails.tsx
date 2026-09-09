import { useRef, useState } from 'react';
import { ArrowUpRight, Link2, LoaderCircle } from 'lucide-react';
import type { OpenTaskResult, TaskLink } from '../../domain/types';
import { relativeTime } from '../../domain/branches';

interface TaskContext {
  repositoryId: string;
  branchId: string;
  demo: boolean;
}
const messages: Record<OpenTaskResult, string> = {
  sent: 'Sent to Codex. Check the desktop app to continue.',
  'not-linked':
    'This task is no longer linked here. Refresh the workspace and check Codex tasks in Settings.',
  'invalid-link': 'This saved task has an unsupported link. Find it in Codex by its title.',
  unavailable:
    'Install and open the Codex desktop app, then try again. The command-line tool alone cannot open this link.',
  failed: 'Could not open Codex. Open the desktop app, then try again.',
};

function OpenTaskAction({ task, repositoryId, branchId, demo }: TaskContext & { task: TaskLink }) {
  const busy = useRef(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState('');
  const open = async () => {
    if (busy.current) return;
    if (demo) {
      setMessage(
        'This is a fictional task. Connect your projects and Codex tasks to open your own work.',
      );
      return;
    }
    if (!window.openbranches) {
      setMessage('Open task links from the OpenBranches desktop app.');
      return;
    }
    busy.current = true;
    setOpening(true);
    setMessage('');
    try {
      const result = await window.openbranches.openCodexTask({
        repositoryId,
        branchId,
        taskId: task.id,
      });
      setMessage(messages[result] ?? messages.failed);
    } catch {
      setMessage(messages.failed);
    } finally {
      busy.current = false;
      setOpening(false);
    }
  };
  return (
    <div className="task-open">
      <button
        className="text-button"
        aria-label={`Open ${task.title} in Codex`}
        aria-busy={opening}
        disabled={opening}
        onClick={() => void open()}
      >
        {opening ? 'Opening…' : 'Open in Codex'}
        {opening ? (
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
        ) : (
          <ArrowUpRight size={14} aria-hidden="true" />
        )}
      </button>
      <p className="task-open-message" role="status">
        {message}
      </p>
    </div>
  );
}

export function TaskDetails({ tasks, ...context }: TaskContext & { tasks: TaskLink[] }) {
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
              <OpenTaskAction task={task} {...context} />
            </div>
          </div>
        ))}
      </div>
      {tasks.length > 3 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer tasks' : `Show all ${tasks.length} tasks`}
        </button>
      )}
      {!context.demo && (
        <p className="evidence-note">
          Saved task history. Current activity in Codex is not available.
        </p>
      )}
    </section>
  );
}
