import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Branch, GitRef, Repository, Target, Worktree } from '../../src/domain/types';
import { titleFromBranch } from '../../src/domain/branches';
import { standardIntegrationNames } from '../../src/domain/integrationTargets';
import { gitEnvironment } from './installation';

const exec = promisify(execFile);
const REF_FORMAT =
  '%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(upstream)%00%(symref)%00%(authorname)';
function createGitRunner(executable: string) {
  return async (path: string, args: string[]): Promise<string> => {
    const { stdout } = await exec(
      executable,
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', path, ...args],
      {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
        env: gitEnvironment(),
      },
    );
    return stdout;
  };
}
export const git = createGitRunner('git');
// Status can invoke repository-defined clean/process filters. Disable those
// commands during inspection; Git's fsmonitor hook is disabled in the runner.
async function readStatus(
  worktree: Worktree,
  git: ReturnType<typeof createGitRunner>,
): Promise<string> {
  let filterKeys = '';
  try {
    filterKeys = await git(worktree.path, [
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(clean|process|smudge|required)$',
    ]);
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
  }
  const drivers = new Set(
    filterKeys
      .split('\0')
      .filter(Boolean)
      .map((key) => key.replace(/\.(clean|process|smudge|required)$/, '')),
  );
  const overrides = [...drivers].flatMap((driver) => [
    '-c',
    `${driver}.clean=`,
    '-c',
    `${driver}.process=`,
    '-c',
    `${driver}.smudge=`,
    '-c',
    `${driver}.required=false`,
  ]);
  if (drivers.size)
    worktree.statusNote =
      'File filters were skipped during read-only inspection; changed-file counts may include filter differences.';
  return git(worktree.path, [
    ...overrides,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=normal',
  ]);
}
export function parseRefs(output: string): GitRef[] {
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [fullName, sha, updatedAt, subject, upstream, symbolic, author] = line.split('\0');
      if (symbolic || !sha || !fullName.startsWith('refs/')) return [];
      const isRemote = fullName.startsWith('refs/remotes/');
      const short = fullName.replace(/^refs\/(heads|remotes)\//, '');
      const slash = short.indexOf('/');
      return [
        {
          fullName,
          sha,
          updatedAt,
          subject,
          ...(author ? { author } : {}),
          upstream: upstream || undefined,
          name: isRemote ? short.slice(slash + 1) : short,
          remote: isRemote ? short.slice(0, slash) : undefined,
        },
      ];
    });
}
export function parseRemoteDefaults(output: string): { name: string; remote: string }[] {
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [fullName, , , , , symbolic] = line.split('\0');
      const head = fullName.match(/^refs\/remotes\/(.+)\/HEAD$/);
      if (!head || !symbolic) return [];
      const prefix = `refs/remotes/${head[1]}/`;
      if (!symbolic.startsWith(prefix) || symbolic === fullName) return [];
      const name = symbolic.slice(prefix.length);
      return name && name !== 'HEAD' ? [{ name, remote: head[1] }] : [];
    });
}
export function parseWorktrees(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Worktree | undefined;
  for (const field of output.split('\0')) {
    if (field.startsWith('worktree ')) {
      current = {
        path: field.slice(9),
        head: '',
        detached: false,
        available: false,
        dirty: null,
        changedFiles: null,
      };
      worktrees.push(current);
    } else if (current) {
      if (field.startsWith('HEAD ')) current.head = field.slice(5);
      if (field.startsWith('branch ')) current.branch = field.slice(7);
      if (field === 'detached') current.detached = true;
      if (field.startsWith('prunable')) current.prunable = field.slice(9) || 'Missing worktree';
      if (field.startsWith('locked')) current.locked = field.slice(7) || 'Locked';
    }
  }
  return worktrees;
}
export function sanitizeRemote(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return raw.replace(/^(https?:\/\/)[^@]+@/, '$1');
  }
}
function countStatusEntries(output: string): number {
  const fields = output.split('\0');
  let count = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    count++;
    if (/^[RC]|^.[RC]/.test(field.slice(0, 2))) i++;
  }
  return count;
}
export async function scanRepository(inputPath: string, executable = 'git'): Promise<Repository> {
  const git = createGitRunner(executable);
  const path = await realpath(
    (await git(inputPath, ['rev-parse', '--show-toplevel'])).replace(/\n$/, ''),
  );
  const commonDir = await realpath(
    resolve(path, (await git(path, ['rev-parse', '--git-common-dir'])).replace(/\n$/, '')),
  );
  const id = createHash('sha256').update(commonDir).digest('hex').slice(0, 16);
  const [refOutput, worktreeOutput, remoteNames, shallowOutput] = await Promise.all([
    git(path, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
    git(path, ['worktree', 'list', '--porcelain', '-z']),
    git(path, ['remote']),
    git(path, ['rev-parse', '--is-shallow-repository']),
  ]);
  const refs = parseRefs(refOutput);
  const worktrees = parseWorktrees(worktreeOutput);
  // Bound subprocess concurrency even when a repository has hundreds of worktrees.
  for (let start = 0; start < worktrees.length; start += 4) {
    await Promise.all(
      worktrees.slice(start, start + 4).map(async (worktree) => {
        try {
          await access(worktree.path);
          worktree.available = true;
          const status = await readStatus(worktree, git);
          worktree.changedFiles = countStatusEntries(status);
          worktree.dirty = worktree.changedFiles > 0;
        } catch {
          /* Keep dirty state unknown, including folders containing a broken gitdir. */
        }
      }),
    );
  }
  const remotes = (
    await Promise.all(
      remoteNames
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(async (name) => {
          try {
            return {
              name,
              url: sanitizeRemote((await git(path, ['remote', 'get-url', name])).trim()),
            };
          } catch {
            return null;
          }
        }),
    )
  ).filter((remote): remote is { name: string; url: string } => remote !== null);
  const targets: Target[] = standardIntegrationNames.flatMap((name) => {
    const local = refs.find((r) => r.fullName === `refs/heads/${name}`);
    const remote = refs.find((r) => r.fullName === `refs/remotes/origin/${name}`);
    const ref = local ?? remote;
    return ref
      ? [{ name, sha: ref.sha, source: local ? ('local' as const) : ('cached-remote' as const) }]
      : [];
  });
  if (!targets.length) {
    const remoteDefault = parseRemoteDefaults(refOutput).sort(
      (left, right) =>
        Number(right.remote === 'origin') - Number(left.remote === 'origin') ||
        left.remote.localeCompare(right.remote) ||
        left.name.localeCompare(right.name),
    )[0];
    if (remoteDefault) {
      const local = refs.find((ref) => ref.fullName === `refs/heads/${remoteDefault.name}`);
      const remote = refs.find(
        (ref) => ref.fullName === `refs/remotes/${remoteDefault.remote}/${remoteDefault.name}`,
      );
      const ref = remote ? (local ?? remote) : undefined;
      if (ref)
        targets.push({
          name: remoteDefault.name,
          sha: ref.sha,
          source: local ? 'local' : 'cached-remote',
          remote: remoteDefault.remote,
          role: 'default',
        });
    }
  }
  const contained = new Map<string, Set<string>>();
  for (const target of targets) {
    try {
      contained.set(
        target.name,
        new Set(
          (
            await git(path, [
              'for-each-ref',
              `--merged=${target.sha}`,
              '--format=%(refname)',
              'refs/heads',
              'refs/remotes',
            ])
          )
            .trim()
            .split('\n'),
        ),
      );
    } catch {
      /* Missing history is represented as unknown. */
    }
  }
  const shallow = shallowOutput.trim() === 'true';
  const consumed = new Set<string>();
  const branches: Branch[] = [];
  const integrationFor = (ref: GitRef) =>
    Object.fromEntries(
      targets.map((target) => [
        target.name,
        contained.get(target.name)?.has(ref.fullName)
          ? ('integrated' as const)
          : shallow || !contained.has(target.name)
            ? ('unknown' as const)
            : ('pending' as const),
      ]),
    );
  const append = (local: GitRef | undefined, remote: GitRef | undefined) => {
    const ref = local ?? remote!;
    const branch: Branch = {
      id: `${id}:${ref.fullName}`,
      repositoryId: id,
      name: ref.name,
      title: titleFromBranch(ref.name),
      local,
      remote,
      worktrees: local ? worktrees.filter((w) => w.branch === local.fullName) : [],
      updatedAt: ref.updatedAt || new Date(0).toISOString(),
      integration: integrationFor(ref),
      remoteIntegration: local && remote ? integrationFor(remote) : undefined,
      codexNamed: ref.name.startsWith('codex/'),
      detached: false,
    };
    branches.push(branch);
  };
  for (const local of refs.filter((r) => !r.remote)) {
    const remote = local.upstream
      ? refs.find((r) => r.fullName === local.upstream && r.remote)
      : undefined;
    if (remote) consumed.add(remote.fullName);
    append(local, remote);
  }
  for (const remote of refs.filter((r) => r.remote && !consumed.has(r.fullName)))
    append(undefined, remote);
  for (const worktree of worktrees.filter((w) => w.detached)) {
    const name = `Detached at ${worktree.head.slice(0, 7)}`;
    let updatedAt = '';
    try {
      updatedAt = (await git(path, ['show', '-s', '--format=%cI', worktree.head, '--'])).trim();
    } catch {
      /* Missing detached objects keep an unknown age. */
    }
    branches.push({
      id: `${id}:detached:${worktree.path}`,
      repositoryId: id,
      name,
      title: name,
      worktrees: [worktree],
      updatedAt,
      integration: Object.fromEntries(targets.map((t) => [t.name, 'unknown'])),
      codexNamed: false,
      detached: true,
    });
  }
  return {
    id,
    name: path.split('/').pop()!,
    path,
    commonDir,
    targets,
    branches,
    worktrees,
    remotes,
    scannedAt: new Date().toISOString(),
    shallow,
  };
}
