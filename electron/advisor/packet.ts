import { createHash } from 'node:crypto';
import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';
import type { Branch, Repository, Snapshot } from '../../src/domain/types';
import { featureBranches, DAY } from '../../src/domain/branches';
import { ADVISOR_INSTRUCTIONS, ADVISOR_POLICY as policy } from './policy';

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export interface AdvisorFact {
  id: string;
  kind: string;
  value: Value;
}
export interface AdvisorBranch {
  id: string;
  project: string;
  name: string;
  checkedAt: { local: string; remote: string | null };
  facts: AdvisorFact[];
}
export interface AdvisorPacket {
  version: 1;
  preparedAt: string;
  coverage: { included: number; total: number; unavailable: number };
  branches: AdvisorBranch[];
}
export interface PreparedAnalysis {
  packet: AdvisorPacket;
  input: string;
  revision: string;
  estimatedTokens: number;
  bindings: Map<string, { repositoryId: string; branchId: string }>;
}
let tokenizer: Tiktoken | undefined;
export function tokenCount(text: string): number {
  tokenizer ??= new Tiktoken(o200k);
  // Treat embedded special-token spellings as ordinary untrusted text.
  return tokenizer.encode(text, [], []).length;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const timestamp = (value: string | undefined) =>
  Number.isFinite(Date.parse(value ?? '')) ? new Date(value!).toISOString() : 'unknown';
export const advisorBranchId = (branchId: string) => `b-${hash(branchId).slice(0, 20)}`;

function text(value: string, limit: number): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[link omitted]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s"'<>]+/g, '[path omitted]')
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/g, '[credential omitted]');
  return Array.from(sanitized).slice(0, limit).join('');
}
function factsFor(repository: Repository, branch: Branch, now: number): AdvisorBranch {
  const id = advisorBranchId(branch.id);
  const facts: AdvisorFact[] = [];
  const add = (kind: string, value: Value) =>
    facts.push({ id: `e-${hash(JSON.stringify([id, kind, value])).slice(0, 20)}`, kind, value });
  const validSha = (sha: string | undefined): string | null =>
    sha && /^[a-f\d]{40,64}$/i.test(sha) ? sha : null;
  add('local', { present: !!branch.local, tip: validSha(branch.local?.sha) });
  add(
    'remote',
    branch.remote
      ? {
          tip: validSha(branch.remote.sha),
          source: branch.remote.source ?? 'cached-git-reference',
          presence: branch.remote.presence ?? 'unknown',
          unavailable: !!repository.github?.error,
          partial: repository.github?.partial ?? false,
        }
      : null,
  );
  add('last-commit', {
    at: timestamp(branch.updatedAt),
    subject: text((branch.local ?? branch.remote)?.subject ?? '', 160),
  });
  add('worktrees', {
    count: branch.worktrees.length,
    dirty: branch.worktrees.filter((w) => w.dirty === true).length,
    unchecked: branch.worktrees.filter((w) => w.dirty === null).length,
    unavailable: branch.worktrees.filter((w) => !w.available).length,
    locked: branch.worktrees.filter((w) => !!w.locked).length,
    detached: branch.detached,
  });
  add(
    'integration',
    repository.targets.map((target) => ({
      target: text(target.name, 100),
      tip: validSha(target.sha),
      source: target.source,
      local: branch.local ? (branch.integration[target.name] ?? 'unknown') : 'unknown',
      remote: branch.remote
        ? ((branch.local
            ? branch.remoteIntegration?.[target.name]
            : branch.integration[target.name]) ?? 'unknown')
        : 'unknown',
    })),
  );
  const stale = (date: string | undefined, maxAge: number) => {
    const age = now - Date.parse(date ?? '');
    return !Number.isFinite(age) || age < 0 || age > maxAge;
  };
  add('source', {
    shallow: repository.shallow,
    localStale: stale(repository.scannedAt, 180_000),
    remoteStale: stale(repository.github?.checkedAt, 300_000),
    remoteUnavailable: !!repository.github?.error,
    remotePartial: repository.github?.partial ?? false,
  });
  if (branch.pullRequest)
    add('pull-request', {
      number: branch.pullRequest.number,
      title: text(branch.pullRequest.title, 160),
      state: branch.pullRequest.state,
      draft: branch.pullRequest.draft ?? false,
      base: text(branch.pullRequest.base, 100),
      tip: validSha(branch.pullRequest.headSha),
      updatedAt: timestamp(branch.pullRequest.updatedAt),
    });
  if (branch.tasks?.length) {
    add(
      'tasks',
      branch.tasks.slice(0, 3).map((task) => ({
        title: text(task.title, 180),
        association: task.association,
        activity: task.status,
        archived: task.archived ?? false,
        updatedAt: timestamp(task.updatedAt),
        summary: text(task.summary ?? '', 600),
        summaryTruncated: Array.from(task.summary ?? '').length > 600,
      })),
    );
    add('task-activity', {
      active: branch.tasks.filter((task) => task.status === 'active').length,
      unknown: branch.tasks.filter((task) => task.status === 'unknown').length,
    });
    if (branch.tasks.length > 3) add('additional-tasks', branch.tasks.length - 3);
  }
  return {
    id,
    project: text(repository.name, 120),
    name: text(branch.name, 200),
    checkedAt: {
      local: timestamp(repository.scannedAt),
      remote: repository.github?.checkedAt ? timestamp(repository.github.checkedAt) : null,
    },
    facts,
  };
}
function priority(branch: Branch, now: number) {
  const age = (now - Date.parse(branch.updatedAt)) / DAY;
  return (
    (branch.worktrees.some((w) => w.dirty) ? 40 : 0) +
    (branch.local && !branch.remote ? 30 : 0) +
    (age >= 14 && Object.values(branch.integration).includes('pending') ? 20 : 0) +
    (branch.pullRequest?.state === 'open' ? 10 : 0)
  );
}

export function prepareAnalysis(
  snapshot: Snapshot,
  options: { now?: number; lastReviewed?: ReadonlyMap<string, number> } = {},
): PreparedAnalysis {
  if (snapshot.scanning)
    throw new Error('Wait for repository inspection to finish before preparing a review.');
  const now = options.now ?? Date.now();
  const candidates = snapshot.repositories.flatMap((repository) =>
    featureBranches(repository).map((branch) => ({ repository, branch })),
  );
  const available = candidates
    .filter(({ repository }) => !repository.error)
    .sort(
      (a, b) =>
        (options.lastReviewed?.get(a.branch.id) ?? 0) -
          (options.lastReviewed?.get(b.branch.id) ?? 0) ||
        priority(b.branch, now) - priority(a.branch, now) ||
        a.branch.id.localeCompare(b.branch.id),
    );
  const packet: AdvisorPacket = {
    version: 1,
    preparedAt: new Date(now).toISOString(),
    coverage: {
      included: 0,
      total: candidates.length,
      unavailable: candidates.length - available.length,
    },
    branches: [],
  };
  const bindings = new Map<string, { repositoryId: string; branchId: string }>();
  const instructionTokens = tokenCount(ADVISOR_INSTRUCTIONS);
  let estimate = tokenCount(JSON.stringify(packet)) + instructionTokens;
  const limit = policy.maxInputTokens - policy.framingReserveTokens;
  let misses = 0;
  for (const { repository, branch } of available) {
    const record = factsFor(repository, branch, now);
    const cost = tokenCount(JSON.stringify(record)) + 2;
    if (estimate + cost > limit) {
      if (++misses >= 8) break;
      continue;
    }
    misses = 0;
    estimate += cost;
    packet.branches.push(record);
    bindings.set(record.id, { repositoryId: repository.id, branchId: branch.id });
    if (limit - estimate < 150) break;
  }
  packet.coverage.included = packet.branches.length;
  let input = JSON.stringify(packet);
  let estimatedTokens = tokenCount(input) + instructionTokens;
  while (estimatedTokens > limit && packet.branches.length) {
    bindings.delete(packet.branches.pop()!.id);
    packet.coverage.included = packet.branches.length;
    input = JSON.stringify(packet);
    estimatedTokens = tokenCount(input) + instructionTokens;
  }
  // Scan timestamps do not invalidate a decision unless freshness or evidence changes.
  const revision = hash(
    JSON.stringify(
      [...packet.branches]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ checkedAt: _checkedAt, ...record }) => record),
    ),
  );
  return { packet, input, revision, estimatedTokens, bindings };
}
