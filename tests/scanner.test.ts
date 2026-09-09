import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepository, parseWorktrees, sanitizeRemote } from '../electron/git/scanner';

const directories: string[] = [];
function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  }).trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openbranches-test-'));
  directories.push(root);
  git(root, 'init', '-b', 'main');
  await writeFile(join(root, 'readme.txt'), 'original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial');
  git(root, 'branch', 'develop');
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('read-only Git inspection', () => {
  it('tracks integration independently, preserves unpublished work, and never changes refs/index/files', async () => {
    const root = await fixture();
    git(root, 'checkout', '-b', 'codex/unfinished');
    await writeFile(join(root, 'feature.txt'), 'new feature\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Feature');
    const featureSha = git(root, 'rev-parse', 'HEAD');
    git(root, 'branch', '-f', 'develop', featureSha);
    await writeFile(join(root, 'draft.txt'), 'not committed\n');
    const before = {
      refs: git(root, 'show-ref'),
      status: git(root, 'status', '--porcelain=v1'),
      index: await readFile(join(root, '.git/index')),
    };
    const result = await scanRepository(root);
    const branch = result.branches.find((b) => b.name === 'codex/unfinished')!;
    expect(branch.integration).toEqual({ develop: 'integrated', main: 'pending' });
    expect(branch.worktrees[0]).toMatchObject({ dirty: true, changedFiles: 1, available: true });
    expect(branch.remote).toBeUndefined();
    expect(git(root, 'show-ref')).toBe(before.refs);
    // Check the index before another Git status could refresh it.
    expect(await readFile(join(root, '.git/index'))).toEqual(before.index);
    expect(await readFile(join(root, 'draft.txt'), 'utf8')).toBe('not committed\n');
    expect(git(root, 'status', '--porcelain=v1')).toBe(before.status);
  });

  it('keeps differing local and tracked remote tips and assesses both histories', async () => {
    const root = await fixture();
    const initial = git(root, 'rev-parse', 'HEAD');
    git(root, 'remote', 'add', 'origin', 'https://github.com/example/project.git');
    git(root, 'checkout', '-b', 'codex/shared');
    git(root, 'update-ref', 'refs/remotes/origin/codex/shared', initial);
    git(root, 'branch', '--set-upstream-to=origin/codex/shared');
    await writeFile(join(root, 'feature.txt'), 'local only');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Local commit');
    const result = await scanRepository(root);
    const branch = result.branches.find((b) => b.name === 'codex/shared')!;
    expect(branch.local?.sha).not.toBe(branch.remote?.sha);
    expect(branch.integration.main).toBe('pending');
    expect(branch.remoteIntegration?.main).toBe('integrated');
    expect(result.branches.filter((b) => b.name === 'codex/shared')).toHaveLength(1);
  });

  it('uses a shared repository identity across worktrees and inspects detached work', async () => {
    const root = await fixture();
    const linked = join(root, 'work tree');
    git(root, 'worktree', 'add', '--detach', linked, 'HEAD');
    const [primary, secondary] = await Promise.all([scanRepository(root), scanRepository(linked)]);
    expect(primary.id).toBe(secondary.id);
    const detached = primary.branches.find((b) => b.detached)!;
    expect(detached.worktrees[0].path).toBe(await realpath(linked));
    expect(new Date(detached.updatedAt).getUTCFullYear()).toBeGreaterThan(2020);
    expect(detached.integration.main).toBe('unknown');
  });

  it('does not run configured clean filters while inspecting modified files', async () => {
    const root = await fixture();
    await writeFile(join(root, '.gitattributes'), '*.txt filter=fixture\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Attributes');
    const marker = join(root, 'FILTER-RAN');
    git(root, 'config', 'filter.fixture.clean', `touch '${marker}'; cat`);
    git(root, 'config', 'filter.fixture.required', 'true');
    await writeFile(join(root, 'readme.txt'), 'modified and not cached\n');
    const result = await scanRepository(root);
    await expect(access(marker)).rejects.toThrow();
    expect(result.worktrees[0].dirty).toBe(true);
    expect(result.worktrees[0].statusNote).toContain('filters were skipped');
  });

  it('does not call squash-equivalent work integrated by ancestry', async () => {
    const root = await fixture();
    git(root, 'checkout', '-b', 'codex/squashed');
    await writeFile(join(root, 'feature.txt'), 'feature');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Feature');
    git(root, 'checkout', 'main');
    git(root, 'merge', '--squash', 'codex/squashed');
    git(root, 'commit', '-m', 'Squash feature');
    const result = await scanRepository(root);
    expect(result.branches.find((b) => b.name === 'codex/squashed')?.integration.main).toBe(
      'pending',
    );
  });

  it('handles empty repositories without inventing targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openbranches-empty-'));
    directories.push(root);
    git(root, 'init', '-b', 'main');
    const result = await scanRepository(root);
    expect(result.targets).toEqual([]);
    expect(result.branches).toEqual([]);
  });
});

it('parses paths containing whitespace and records missing and locked worktrees', () => {
  expect(
    parseWorktrees(
      'worktree /tmp/path\nwith space\0HEAD abc\0detached\0locked task active\0prunable gitdir missing\0\0',
    )[0],
  ).toMatchObject({
    path: '/tmp/path\nwith space',
    head: 'abc',
    detached: true,
    locked: 'task active',
    prunable: 'gitdir missing',
    dirty: null,
  });
});

it('strips credentials and query strings before sharing remote metadata', () => {
  expect(sanitizeRemote('https://user:secret@github.com/example/repo.git?token=secret#token')).toBe(
    'https://github.com/example/repo.git',
  );
  expect(sanitizeRemote('git@github.com:example/repo.git')).toBe('git@github.com:example/repo.git');
});
