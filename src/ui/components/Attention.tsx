import { useState } from 'react';
import { ArrowUpRight, Check, Clock3, GitBranch, Laptop, Pause, Sparkles } from 'lucide-react';
import type { Recommendation, Repository } from '../../domain/types';
import { EmptyState } from './Primitives';
import { relativeTime } from '../../domain/branches';

type Decisions = Record<string, { dismissed?: boolean; until?: number }>;
function readDecisions(demo: boolean): Decisions {
  try {
    return JSON.parse(localStorage.getItem(`ob-decisions-${demo ? 'demo' : 'live'}`) ?? '{}');
  } catch {
    return {};
  }
}
export function Attention({
  recommendations,
  repositories,
  onSelect,
  onSettings,
  demo,
}: {
  recommendations: Recommendation[];
  repositories: Repository[];
  onSelect: (repositoryId: string, branchId: string) => void;
  onSettings: () => void;
  demo: boolean;
}) {
  const [decisions, setDecisions] = useState<Decisions>(() => readDecisions(demo));
  const visible = recommendations.filter(
    (r) => !decisions[r.id]?.dismissed && (decisions[r.id]?.until ?? 0) < Date.now(),
  );
  const decide = (id: string, choice: Decisions[string]) => {
    const next = { ...decisions, [id]: choice };
    setDecisions(next);
    localStorage.setItem(`ob-decisions-${demo ? 'demo' : 'live'}`, JSON.stringify(next));
  };
  return (
    <div className="attention-content">
      <div className="advisor-callout">
        <span className="advisor-icon">
          <Sparkles size={21} />
        </span>
        <div>
          <strong>A little context goes a long way.</strong>
          <p>Git evidence is available now. Connect Codex for context-aware recommendations.</p>
        </div>
        <button className="secondary-button" onClick={onSettings}>
          AI settings
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="section-kicker">
        <span>
          WORTH A LOOK <b>{visible.length}</b>
        </span>
        <span>Based on {demo ? 'sample' : 'local'} Git evidence</span>
      </div>
      {!visible.length && (
        <EmptyState
          icon={Check}
          title="A clear headspace"
          description="There are no unsnoozed findings to review. New evidence will show up here."
        />
      )}
      <div className="recommendation-list">
        {visible.slice(0, 50).map((item) => {
          const repo = repositories.find((r) => r.id === item.repositoryId);
          const branch = repo?.branches.find((b) => b.id === item.branchId);
          const Icon =
            item.category === 'local-only'
              ? Laptop
              : item.category === 'forgotten'
                ? Clock3
                : GitBranch;
          return (
            <article key={item.id} className={`recommendation-card ${item.priority}`}>
              <span className="recommendation-icon">
                <Icon size={19} />
              </span>
              <div className="recommendation-body">
                <div className="recommendation-context">
                  {repo?.name}
                  <span>/</span>
                  {branch?.title}
                  <span className="recommendation-checked">{relativeTime(item.checkedAt)}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.explanation}</p>
                <details>
                  <summary>Why this appeared</summary>
                  <ul>
                    {item.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
                <div className="recommendation-actions">
                  <button
                    className="text-button"
                    onClick={() => onSelect(item.repositoryId, item.branchId)}
                  >
                    Inspect branch
                    <ArrowUpRight size={14} />
                  </button>
                  <button onClick={() => decide(item.id, { until: Date.now() + 7 * 86_400_000 })}>
                    <Pause size={13} />
                    Snooze 7 days
                  </button>
                  <button onClick={() => decide(item.id, { dismissed: true })}>Dismiss</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {visible.length > 50 && (
        <p className="muted-note">
          Showing the first 50 findings. Use the branch inventory to explore the full project.
        </p>
      )}
      {Object.keys(decisions).length > 0 && (
        <button
          className="text-button reset-decisions"
          onClick={() => {
            setDecisions({});
            localStorage.removeItem(`ob-decisions-${demo ? 'demo' : 'live'}`);
          }}
        >
          Reset snoozed and dismissed findings
        </button>
      )}
    </div>
  );
}
