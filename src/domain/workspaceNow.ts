import { mergePullEvidence, pullAttentionRank } from './collaboration';
import { observationStale } from './sourceFreshness';
import type { Branch, GitHubPullRequest, PullRequest, Repository } from './types';
import type { WorkSignal } from './workSpotlight';
import { activeWorkspaceSpotlights } from './workSpotlight';

export type WorkspaceNowFilter = 'all' | 'live' | 'pulls';

export interface WorkspaceNowBranch {
  repository: Repository;
  branch: Branch;
  signal: WorkSignal;
}

export interface WorkspaceNowPull {
  id: string;
  pull: PullRequest;
  repositorySlug?: string;
  headName: string;
  repositories: Repository[];
  links: { repository: Repository; branch: Branch }[];
  stale: boolean;
}

export interface WorkspaceNowRow {
  id: string;
  branch?: WorkspaceNowBranch;
  pull?: WorkspaceNowPull;
  updatedAt: string;
}

export interface WorkspaceNowProject {
  id: string;
  name: string;
  detail?: string;
  repositories: Repository[];
  rows: WorkspaceNowRow[];
  live: number;
  waiting: number;
  pulls: number;
  updatedAt: string;
}

export interface WorkspaceNowModel {
  projects: WorkspaceNowProject[];
  live: number;
  waiting: number;
  pulls: number;
  unverifiedPulls: number;
}

interface MutablePull extends WorkspaceNowPull {
  aliases: Set<string>;
}

const parseTime = (value: string | undefined) => Date.parse(value ?? '') || 0;
const uniqueById = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];
const isGitHubPull = (pull: PullRequest): pull is GitHubPullRequest =>
  typeof pull.repository === 'string' &&
  typeof (pull as Partial<GitHubPullRequest>).headName === 'string' &&
  typeof pull.observedAt === 'string';
const pullAliases = (pull: PullRequest) => {
  const aliases = [`url:${pull.url.toLocaleLowerCase()}#${pull.number}`];
  if (pull.repository)
    aliases.push(`repository:${pull.repository.toLocaleLowerCase()}#${pull.number}`);
  return aliases;
};
const pullFreshness = (pull: PullRequest, repositories: Repository[], now: number) => {
  const observedAt =
    pull.observedAt ??
    repositories
      .map((repository) => repository.github?.checkedAt)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1);
  return (
    !!pull.retained ||
    !!pull.sourceError ||
    !observedAt ||
    observationStale(observedAt, 10 * 60_000, now)
  );
};

/** Build a de-duplicated pull index before joining it to live branches. The
 * GitHub listing wins when it has richer evidence; branch-level cached PRs
 * remain useful during a partial or unavailable GitHub read. */
function currentPulls(repositories: Repository[], now: number): WorkspaceNowPull[] {
  const records: MutablePull[] = [];
  const byAlias = new Map<string, MutablePull>();

  const add = (pull: PullRequest, repository: Repository, branch?: Branch) => {
    if (pull.state !== 'open') return;
    const aliases = pullAliases(pull);
    let record = aliases.map((alias) => byAlias.get(alias)).find(Boolean);
    if (!record) {
      record = {
        id: aliases[1] ?? aliases[0],
        pull,
        repositorySlug: pull.repository,
        headName: isGitHubPull(pull) ? pull.headName : (branch?.name ?? pull.title),
        repositories: [],
        links: [],
        stale: true,
        aliases: new Set(),
      };
      records.push(record);
    } else if (isGitHubPull(pull)) {
      record.pull = isGitHubPull(record.pull) ? mergePullEvidence(pull, record.pull) : pull;
      record.repositorySlug = pull.repository;
      record.headName = pull.headName;
    } else if (
      !isGitHubPull(record.pull) &&
      parseTime(pull.updatedAt) > parseTime(record.pull.updatedAt)
    ) {
      record.pull = pull;
      record.repositorySlug = pull.repository ?? record.repositorySlug;
      record.headName = branch?.name ?? record.headName;
    }
    record.repositories = uniqueById([...record.repositories, repository]);
    if (
      branch &&
      !record.links.some(
        (link) => link.repository.id === repository.id && link.branch.id === branch.id,
      )
    )
      record.links.push({ repository, branch });
    for (const alias of [...record.aliases, ...aliases]) {
      record.aliases.add(alias);
      byAlias.set(alias, record);
    }
  };

  for (const repository of repositories) {
    for (const pull of repository.github?.pulls ?? []) add(pull, repository);
    for (const branch of repository.branches)
      if (branch.pullRequest) add(branch.pullRequest, repository, branch);
  }

  return records
    .map(({ aliases: _aliases, ...record }) => ({
      ...record,
      stale: pullFreshness(record.pull, record.repositories, now),
    }))
    .sort(
      (left, right) =>
        pullAttentionRank(left.pull as GitHubPullRequest, now) -
          pullAttentionRank(right.pull as GitHubPullRequest, now) ||
        parseTime(right.pull.updatedAt) - parseTime(left.pull.updatedAt) ||
        left.id.localeCompare(right.id),
    );
}

const pullForBranch = (pulls: WorkspaceNowPull[], repository: Repository, branch: Branch) => {
  const direct = pulls.find((pull) =>
    pull.links.some((link) => link.repository.id === repository.id && link.branch.id === branch.id),
  );
  if (direct || !branch.pullRequest) return direct;
  const aliases = new Set(pullAliases(branch.pullRequest));
  return pulls.find((pull) => pullAliases(pull.pull).some((alias) => aliases.has(alias)));
};

const projectIdentity = (repository: Repository, pull?: WorkspaceNowPull) => {
  const repositorySlugs = [
    ...new Set(
      (repository.github?.pulls ?? []).map((candidate) => candidate.repository).filter(Boolean),
    ),
  ];
  const slug =
    pull?.repositorySlug ?? (repositorySlugs.length === 1 ? repositorySlugs[0] : undefined);
  if (!slug) return { id: `local:${repository.id}`, name: repository.name, detail: undefined };
  return {
    id: `github:${slug.toLocaleLowerCase()}`,
    name: slug.split('/').at(-1) || repository.name,
    detail: slug,
  };
};

/** The workspace control panel includes only fresh, verified runtime sessions
 * and PRs whose last recorded state is open. Recent commits and dirty trees do
 * not imply that somebody is working now. */
export function workspaceNow(repositories: Repository[], now = Date.now()): WorkspaceNowModel {
  const observedPulls = currentPulls(repositories, now);
  const pulls = observedPulls.filter((pull) => !pull.stale);
  const attachedPulls = new Set<string>();
  const groups = new Map<
    string,
    WorkspaceNowProject & { repositoryIds: Set<string>; pullIds: Set<string> }
  >();

  const ensureGroup = (repository: Repository, pull?: WorkspaceNowPull) => {
    const identity = projectIdentity(repository, pull);
    let group = groups.get(identity.id);
    if (!group) {
      group = {
        ...identity,
        repositories: [],
        repositoryIds: new Set(),
        pullIds: new Set(),
        rows: [],
        live: 0,
        waiting: 0,
        pulls: 0,
        updatedAt: '',
      };
      groups.set(identity.id, group);
    }
    for (const candidate of pull?.repositories ?? [repository]) {
      if (!group.repositoryIds.has(candidate.id)) {
        group.repositoryIds.add(candidate.id);
        group.repositories.push(candidate);
      }
    }
    return group;
  };

  for (const { repository, branch, signal } of activeWorkspaceSpotlights(repositories, now)) {
    const pull = pullForBranch(pulls, repository, branch);
    if (pull) attachedPulls.add(pull.id);
    const group = ensureGroup(repository, pull);
    group.rows.push({
      id: `branch:${repository.id}:${branch.id}`,
      branch: { repository, branch, signal },
      pull,
      updatedAt: [branch.updatedAt, pull?.pull.updatedAt].filter(Boolean).sort().at(-1) ?? '',
    });
    if (signal.kind === 'live') group.live++;
    else group.waiting++;
    if (pull && !group.pullIds.has(pull.id)) {
      group.pullIds.add(pull.id);
      group.pulls++;
    }
  }

  for (const pull of pulls) {
    if (attachedPulls.has(pull.id)) continue;
    const repository = pull.links[0]?.repository ?? pull.repositories[0];
    if (!repository) continue;
    const group = ensureGroup(repository, pull);
    group.rows.push({
      id: `pull:${pull.id}`,
      pull,
      updatedAt: pull.pull.updatedAt,
    });
    if (!group.pullIds.has(pull.id)) {
      group.pullIds.add(pull.id);
      group.pulls++;
    }
  }

  const projects = [...groups.values()]
    .map(({ repositoryIds: _repositoryIds, pullIds: _pullIds, ...group }) => {
      const rows = group.rows.sort(
        (left, right) =>
          (right.branch?.signal.priority ?? 0) - (left.branch?.signal.priority ?? 0) ||
          (left.pull ? pullAttentionRank(left.pull.pull as GitHubPullRequest, now) : 4) -
            (right.pull ? pullAttentionRank(right.pull.pull as GitHubPullRequest, now) : 4) ||
          parseTime(right.updatedAt) - parseTime(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
      return {
        ...group,
        rows,
        updatedAt:
          rows
            .map((row) => row.updatedAt)
            .sort()
            .at(-1) ?? '',
      };
    })
    .sort(
      (left, right) =>
        right.live - left.live ||
        right.waiting - left.waiting ||
        parseTime(right.updatedAt) - parseTime(left.updatedAt) ||
        left.name.localeCompare(right.name),
    );

  return {
    projects,
    live: projects.reduce((sum, project) => sum + project.live, 0),
    waiting: projects.reduce((sum, project) => sum + project.waiting, 0),
    pulls: pulls.length,
    unverifiedPulls: observedPulls.length - pulls.length,
  };
}

const rowSearchText = (project: WorkspaceNowProject, row: WorkspaceNowRow) =>
  [
    project.name,
    project.detail,
    row.branch?.repository.name,
    row.branch?.branch.name,
    row.branch?.branch.title,
    row.branch?.signal.label,
    row.branch?.signal.detail,
    row.pull?.repositorySlug,
    row.pull?.headName,
    row.pull?.pull.title,
    row.pull ? `#${row.pull.pull.number}` : '',
    row.pull?.pull.author?.login,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

export function filterWorkspaceNow(
  model: WorkspaceNowModel,
  filter: WorkspaceNowFilter,
  query: string,
): WorkspaceNowProject[] {
  const needle = query.trim().toLocaleLowerCase();
  return model.projects.flatMap((project) => {
    const seenPulls = new Set<string>();
    const rows = project.rows.filter((row) => {
      if (filter === 'live' && !row.branch) return false;
      if (filter === 'pulls' && !row.pull) return false;
      if (needle && !rowSearchText(project, row).includes(needle)) return false;
      if (filter === 'pulls' && row.pull) {
        if (seenPulls.has(row.pull.id)) return false;
        seenPulls.add(row.pull.id);
      }
      return true;
    });
    if (!rows.length) return [];
    return [
      {
        ...project,
        rows,
        live: rows.filter((row) => row.branch?.signal.kind === 'live').length,
        waiting: rows.filter((row) => row.branch?.signal.kind === 'waiting').length,
        pulls: new Set(rows.flatMap((row) => (row.pull ? [row.pull.id] : []))).size,
      },
    ];
  });
}
