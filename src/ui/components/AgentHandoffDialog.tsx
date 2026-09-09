import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { HandoffPreview, HandoffProvider, HandoffSelection } from '../../domain/types';
import type { HandoffsController } from '../hooks/useHandoffs';
import { ToolIcon } from './AgentBadges';

export function AgentHandoffDialog({
  selections,
  handoffs,
  close,
  sent,
}: {
  selections: HandoffSelection[];
  handoffs: HandoffsController;
  close: () => void;
  sent: () => void;
}) {
  const [preview, setPreview] = useState<HandoffPreview>();
  const [provider, setProvider] = useState<HandoffProvider>('codex');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    const previous = document.activeElement;
    closeButton.current?.focus();
    void handoffs
      .preview(selections)
      .then((value) => {
        if (!current) return;
        setPreview(value);
        const first = value.providers.find((item) => item.installed);
        if (first) setProvider(first.provider);
      })
      .catch((reason) => {
        if (current)
          setError(reason instanceof Error ? reason.message : 'The handoff could not be prepared.');
      });
    return () => {
      current = false;
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body ||
          dialog.current?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, [handoffs.preview, selections]);

  const selectedProvider = preview?.providers.find((item) => item.provider === provider);
  const label = selectedProvider?.label ?? 'agent';
  const tasks = preview?.plans.length ?? 0;
  const branches = preview?.branchCount ?? selections.length;
  const send = async () => {
    if (!preview) return;
    setError('');
    const ok = await handoffs.send({ provider, selections, revision: preview.revision });
    if (ok) sent();
    else setError('The handoff was not sent. Review the message and try again.');
  };

  return (
    <div
      className="modal-backdrop handoff-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !handoffs.busy) close();
      }}
    >
      <div
        className="handoff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !handoffs.busy) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <div>
            <span className="handoff-kicker">AGENT HANDOFF</span>
            <h2 id="handoff-title">
              Send {branches} {branches === 1 ? 'branch' : 'branches'} for investigation
            </h2>
            <p>
              {preview
                ? `${tasks} ${tasks === 1 ? 'task' : 'tasks'} will be created because each project stays in its own workspace.`
                : 'Verifying how many project tasks are needed…'}
            </p>
          </div>
          <button
            ref={closeButton}
            onClick={close}
            aria-label="Close handoff"
            disabled={handoffs.busy}
          >
            <X size={17} />
          </button>
        </header>

        {!preview && !error ? (
          <div className="handoff-loading" role="status">
            <LoaderCircle className="spin" size={20} />
            Verifying the latest branch evidence…
          </div>
        ) : (
          <>
            <section className="handoff-section">
              <div className="handoff-section-title">
                <span>Choose an agent</span>
                <small>Uses each agent’s existing local sign-in</small>
              </div>
              <div className="provider-options" role="radiogroup" aria-label="Coding agent">
                {preview?.providers.map((item) => (
                  <button
                    key={item.provider}
                    className={provider === item.provider ? 'selected' : ''}
                    role="radio"
                    aria-checked={provider === item.provider}
                    disabled={!item.installed || handoffs.busy}
                    onClick={() => setProvider(item.provider)}
                  >
                    <span className="provider-mark">
                      <ToolIcon tool={item.provider} />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.installed ? 'Installed on this Mac' : 'Not installed'}</small>
                    </span>
                    {provider === item.provider && item.installed && <Check size={15} />}
                  </button>
                ))}
              </div>
            </section>

            <section className="handoff-safety">
              <ShieldCheck size={18} />
              <div>
                <strong>Investigate first</strong>
                <p>
                  The agent may inspect code and Git history. It is told not to edit, merge, push,
                  close PRs, or delete branches. You decide what happens after its proposal.
                </p>
              </div>
            </section>

            <section className="handoff-projects">
              {preview?.plans.map((plan) => (
                <details key={plan.repositoryId}>
                  <summary>
                    <span>
                      <strong>{plan.repositoryName}</strong>
                      <small>
                        {plan.branches.length} {plan.branches.length === 1 ? 'branch' : 'branches'}
                      </small>
                    </span>
                    <ChevronDown size={15} />
                  </summary>
                  <div className="handoff-branch-list">
                    {plan.branches.map((branch) => (
                      <code key={branch.id}>{branch.name}</code>
                    ))}
                  </div>
                  <details className="handoff-prompt">
                    <summary>Review exact prompt and evidence</summary>
                    <pre>{plan.prompt}</pre>
                  </details>
                </details>
              ))}
            </section>
          </>
        )}

        {(error || handoffs.error) && (
          <p className="handoff-error" role="alert">
            {handoffs.error || error}
          </p>
        )}
        <footer>
          <button className="secondary-button" onClick={close} disabled={handoffs.busy}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!preview || !selectedProvider?.installed || handoffs.busy}
            onClick={() => void send()}
          >
            {handoffs.busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ToolIcon tool={provider} />
            )}
            Send {branches} to {label}
          </button>
        </footer>
      </div>
    </div>
  );
}
