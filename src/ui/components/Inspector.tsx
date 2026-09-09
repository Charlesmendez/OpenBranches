import { AgentBadges } from './AgentBadges';
import { ArrowUpRight, Check, Copy, FolderOpen, GitBranch, Cloud, Laptop, X } from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { relativeTime, shortPath } from '../../domain/branches';
import { BranchStatus, IconButton } from './Primitives';
import { useState } from 'react';
import { TaskDetails } from './TaskDetails';
import { IntegrationEvidence } from './IntegrationEvidence';

export function Inspector({
  branch,
  repository,
  demo,
  close,
  onError,
}: {
  branch: Branch;
  repository: Repository;
  demo: boolean;
  close: () => void;
  onError: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const worktree = branch.worktrees.find((w) => w.available);
  const differs = branch.local && branch.remote && branch.local.sha !== branch.remote.sha;
  const folderLabel = worktree ? 'Reveal worktree' : 'Reveal repository folder';
  const remoteNote =
    branch.remote?.presence === 'missing'
      ? 'Not listed on GitHub at the last successful check. This is a cached Git reference.'
      : branch.remote?.source === 'github'
        ? `GitHub checked ${relativeTime(branch.remote.checkedAt ?? '')}${repository.github?.error ? ' · source unavailable' : ''}`
        : 'Cached locally · not a live GitHub check';
  const reveal = async () => {
    if (demo) {
      onError('This is a fictional demo path. Connect a repository to reveal its worktrees.');
      return;
    }
    try {
      await window.openbranches?.revealWorktree(repository.id, branch.id);
    } catch (error) {
      onError(String(error));
    }
  };
  const openPr = async () => {
    if (demo) {
      onError('PR numbers in the demo are fictional.');
      return;
    }
    if (branch.pullRequest)
      await window.openbranches
        ?.openExternal(branch.pullRequest.url)
        .catch((error) => onError(String(error)));
  };
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(branch.name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError('Could not copy the branch name.');
    }
  };
  return (
    <aside className="inspector" aria-label="Branch details">
      <div className="inspector-eyebrow">
        <span>BRANCH DETAILS</span>
        <IconButton icon={X} label="Close branch details" onClick={close} />
      </div>
      <div className="inspector-title">
        <span className="branch-glyph">
          <GitBranch size={20} />
        </span>
        <h2>{branch.title}</h2>
        <BranchStatus branch={branch} />
      </div>
      <div className="ref-copy">
        <code>{branch.name}</code>
        <IconButton
          icon={copied ? Check : Copy}
          label="Copy branch name"
          onClick={() => void copyName()}
        />
      </div>
      <AgentBadges branch={branch} />
      <IntegrationEvidence key={`history:${branch.id}`} branch={branch} repository={repository} />
      <section className="inspector-section">
        <h3>Where it lives</h3>
        {(branch.local || branch.detached) && (
          <div className="location-detail">
            <Laptop size={18} />
            <div>
              <strong>This Mac</strong>
              <code>{shortPath(worktree?.path ?? repository.path)}</code>
              {!worktree && <small>Stored in this repository · no available worktree</small>}
              {branch.worktrees.some((w) => w.dirty) && (
                <small className="amber-text">Uncommitted changes</small>
              )}
              {branch.worktrees.some((w) => w.dirty === null) && (
                <small className="amber-text">Worktree changes could not be checked</small>
              )}
              {worktree?.statusNote && <small>{worktree.statusNote}</small>}
            </div>
            <button
              className="text-icon"
              title={folderLabel}
              aria-label={folderLabel}
              onClick={() => void reveal()}
            >
              <ArrowUpRight size={15} />
            </button>
          </div>
        )}
        {branch.remote && (
          <div className="location-detail">
            <Cloud size={18} />
            <div>
              <strong>{branch.remote.source === 'github' ? 'GitHub' : 'Remote reference'}</strong>
              <code>
                {branch.remote.remote}/{branch.remote.name}
              </code>
              <small>{demo ? 'Sample remote state' : remoteNote}</small>
              {differs && (
                <small>
                  Remote tip: {branch.remote.sha.slice(0, 7)}
                  {Object.entries(branch.remoteIntegration ?? {})
                    .filter(([, s]) => s === 'integrated')
                    .map(([target]) => ` · in locally observed ${target} history`)
                    .join('')}
                </small>
              )}
            </div>
          </div>
        )}
      </section>
      <TaskDetails
        key={`${demo}:${repository.id}:${branch.id}`}
        tasks={branch.tasks ?? []}
        repositoryId={repository.id}
        branchId={branch.id}
        demo={demo}
      />
      <section className="inspector-section compact-section">
        <div className="last-checked">
          <span>Evidence checked</span>
          <span>{relativeTime(repository.scannedAt)}</span>
        </div>
      </section>
      <div className="inspector-actions">
        {branch.pullRequest && (
          <button className="primary-button" onClick={() => void openPr()}>
            View PR #{branch.pullRequest.number}
            <ArrowUpRight size={15} />
          </button>
        )}
        {(branch.local || branch.detached) && (
          <button className="secondary-button" onClick={() => void reveal()}>
            <FolderOpen size={16} />
            {folderLabel}
          </button>
        )}
      </div>
    </aside>
  );
}
