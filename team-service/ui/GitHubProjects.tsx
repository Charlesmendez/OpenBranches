import { useEffect, useState } from 'react';
import { ArrowRight, Check, GitFork, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import type { GitHubCatalog, GitHubSetupState } from '../../src/team/github';
import { useAction } from './hooks';
import { Empty, ListSearch, Modal, Notice } from './primitives';
import './github.css';
import { GitHubSelections } from './GitHubSelections';

export function GitHubProjects({
  client,
  workspace,
  revision,
  onChange,
}: {
  client: TeamClient;
  workspace: string;
  revision: string;
  onChange: () => void;
}) {
  const [state, setState] = useState<GitHubSetupState>(),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<GitHubCatalog>(),
    [selection, setSelection] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(12),
    [reviewing, setReviewing] = useState(false);
  const [remove, setRemove] = useState<GitHubSetupState['selections'][number]>(),
    [notice, setNotice] = useState(''),
    [now, setNow] = useState(Date.now());
  const action = useAction();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .githubState(workspace, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setState(value);
          setError('');
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setState(undefined);
          setError(failure.message);
        }
      });
    return () => abort.abort();
  }, [client, workspace, revision, reload]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const proof = state?.proof && Date.parse(state.proof.expiresAt) > now ? state.proof : undefined;
  const visibleCatalog =
    catalog && proof && catalog.proofId === proof.id && Date.parse(catalog.expiresAt) > now
      ? catalog
      : undefined;
  const existing = new Set(state?.selections.map((s) => s.repositoryId));
  const selected = visibleCatalog?.projects.filter((p) => selection.includes(p.id)) ?? [];
  const projects =
    visibleCatalog?.projects.filter((p) =>
      p.fullName.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const refresh = () => {
    setReload((v) => v + 1);
    onChange();
  };
  return (
    <section className="github-setup">
      <div className="github-intro">
        <div className="github-symbol">
          <GitFork size={30} />
        </div>
        <div>
          <span className="eyebrow">PUBLISHED WORK</span>
          <h2>Bring GitHub into the picture.</h2>
          <p>
            Choose the repositories this team can follow. Your Mac's local-sharing choices remain
            separate.
          </p>
        </div>
        <span className="scope-label">
          <ShieldCheck size={15} />
          Owner controls
        </span>
      </div>
      <ol className="github-steps" aria-label="GitHub setup steps">
        {['Verify access', 'Choose repositories', 'Review selection'].map((label, i) => (
          <li
            key={label}
            className={(i === 0 && proof) || (i === 1 && visibleCatalog) ? 'done' : ''}
          >
            <span>
              {(i === 0 && proof) || (i === 1 && visibleCatalog) ? <Check size={13} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {(error || action.error) && (
        <Notice error>
          {error || action.error}
          <button className="text-button" onClick={() => setReload((v) => v + 1)}>
            Refresh
          </button>
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {!state && !error && <Notice>Loading GitHub connections…</Notice>}
      {state && !state.configured && (
        <Empty title="One host setup step remains">
          Ask the person hosting OpenBranches to configure the GitHub App private-key secret.
          Personal GitHub sign-in and local sharing work independently.
        </Empty>
      )}
      {state?.proof && !proof && (
        <Notice>
          Your GitHub access review expired. Verify access again to add projects. Saved selections
          remain available below.
        </Notice>
      )}
      {state?.configured && !visibleCatalog && (
        <div className="github-connect-card">
          <div>
            <h3>{proof ? 'Access verified' : 'Start with your GitHub account'}</h3>
            <p>
              {proof
                ? 'Choose an installation you own. Verification expires after five minutes.'
                : 'Verify the account you own, or an organization where you are an owner. You will choose repositories after returning here.'}
            </p>
          </div>
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const result = await client.githubAuthorize(workspace);
                window.location.assign(result.url);
              })
            }
          >
            {proof ? 'Verify again' : 'Verify GitHub access'}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {proof && !visibleCatalog && (
        <div className="github-installations">
          {!proof.complete && (
            <Notice>
              Some installations could not be verified or are outside this page. Check the app's
              organization Members permission, then verify again.
            </Notice>
          )}
          {!proof.installations.length && (
            <Empty title="No eligible installation found">
              Install this host's GitHub App on an account you own, or ask a GitHub organization
              owner to connect it. Ordinary repository access does not grant organization ownership.
            </Empty>
          )}
          {proof.installations.map((installation) => (
            <button
              className="github-installation"
              key={installation.installationId}
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  setNotice('');
                  const value = await client.githubCatalog(
                    workspace,
                    proof.id,
                    installation.installationId,
                  );
                  setCatalog(value);
                  setSelection([]);
                  setQuery('');
                  setLimit(12);
                  setReviewing(false);
                })
              }
            >
              <GitFork size={22} />
              <span>
                <strong>{installation.accountLogin}</strong>
                <small>
                  {installation.accountType === 'Organization'
                    ? 'Organization owner verified'
                    : 'Account owner verified'}
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      )}
      {visibleCatalog && (
        <div className="github-catalog">
          <header>
            <div>
              <h3>{visibleCatalog.installation.accountLogin}</h3>
              <p>
                {visibleCatalog.projects.length.toLocaleString()} repositories available · Select up
                to 100
              </p>
            </div>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() => {
                setCatalog(undefined);
                setSelection([]);
              }}
            >
              Change account
            </button>
          </header>
          {!visibleCatalog.complete && (
            <Notice>
              This repository list is incomplete. Only the repositories shown here can be selected.
            </Notice>
          )}
          <ListSearch
            label="Search GitHub repositories"
            placeholder="Find a repository…"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(12);
            }}
          />
          <div className="github-project-options">
            {projects.slice(0, limit).map((p) => (
              <label key={p.id} className="github-project-option">
                <input
                  type="checkbox"
                  checked={selection.includes(p.id)}
                  disabled={
                    action.busy ||
                    existing.has(p.id) ||
                    (!selection.includes(p.id) && selection.length >= 100)
                  }
                  onChange={(e) => {
                    setReviewing(false);
                    setSelection((old) =>
                      e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                    );
                  }}
                />
                <span>
                  <strong>{p.fullName}</strong>
                  <small>
                    {p.private ? 'Private' : 'Public'}
                    {p.archived ? ' · Archived' : ''}
                    {existing.has(p.id) ? ' · Already selected' : ''}
                  </small>
                </span>
                {p.private && <LockKeyhole size={14} />}
              </label>
            ))}
          </div>
          {!projects.length && <Empty title="No matching repositories">Try another name.</Empty>}
          {projects.length > limit && (
            <button className="more-branches" onClick={() => setLimit((v) => v + 24)}>
              Show more repositories
            </button>
          )}
          <footer>
            <span>{selection.length} selected</span>
            <button
              className="primary"
              disabled={action.busy || !selected.length}
              onClick={() => setReviewing(true)}
            >
              Review selection
              <ArrowRight size={15} />
            </button>
          </footer>
        </div>
      )}
      {state && (
        <GitHubSelections
          selections={state.selections}
          onRemove={(value) => {
            action.clear();
            setRemove(value);
          }}
        />
      )}
      {reviewing && visibleCatalog && (
        <Modal
          title="Review GitHub projects"
          onClose={() => {
            if (!action.busy) setReviewing(false);
          }}
        >
          <p>Add these {selected.length} repositories to this workspace?</p>
          <ul className="github-review-list">
            {selected.map((p) => (
              <li key={p.id}>
                {p.fullName}
                <span>{p.private ? 'Private' : 'Public'}</span>
              </li>
            ))}
          </ul>
          <Notice>
            New projects start with owner-only access. Existing project permissions apply when a
            previously selected repository is added again. Local branches from teammates' Macs still
            require their own approval.
          </Notice>
          <p className="github-preview-note">
            After you add them, OpenBranches reads branch and pull-request metadata in the
            background. Repository contents stay on GitHub.
          </p>
          {action.error && <Notice error>{action.error}</Notice>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setReviewing(false)}
            >
              Back
            </button>
            <button
              className="primary"
              disabled={action.busy || !selected.length}
              onClick={() =>
                void action.run(async () => {
                  await client.githubSelect(workspace, visibleCatalog.id, selection);
                  setReviewing(false);
                  setCatalog(undefined);
                  setSelection([]);
                  setNotice(
                    'GitHub projects selected. Their first background refresh is now queued.',
                  );
                  refresh();
                })
              }
            >
              Add {selected.length} projects
            </button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal
          title="Remove GitHub selection?"
          onClose={() => {
            if (!action.busy) setRemove(undefined);
          }}
        >
          <p>
            Remove <strong>{remove.fullName}</strong> from this workspace's GitHub sources? The team
            project and any local reports remain available under their existing permissions.
          </p>
          {action.error && <Notice error>{action.error}</Notice>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setRemove(undefined)}
            >
              Keep selection
            </button>
            <button
              className="danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await client.githubRemove(workspace, remove.projectId);
                  setRemove(undefined);
                  setCatalog(undefined);
                  setNotice('GitHub selection removed.');
                  refresh();
                })
              }
            >
              Remove selection
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
