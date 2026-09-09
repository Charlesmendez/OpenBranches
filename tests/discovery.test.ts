import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savedCodexProjects, readCodexProjects } from '../electron/discovery/codexProjects';
import { ProjectDiscoveryService } from '../electron/discovery/service';
import { RepositoryService } from '../electron/services/repositories';
import { AppStore } from '../electron/services/store';
import { stopMonitoring } from '../electron/services/monitoring';
import { createDemoSnapshot } from '../src/data/demo';
import { projectMatches } from '../src/domain/projects';
import type { DiscoveredProject, Repository, Snapshot } from '../src/domain/types';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'openbranches-discovery-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
const project = (path = '/fixture/atlas'): DiscoveredProject => ({
  id: path,
  name: 'Atlas',
  path,
  source: 'codex',
  available: true,
});
const repo = (path = '/fixture/atlas'): Repository => ({
  ...createDemoSnapshot().repositories[0],
  id: 'atlas',
  path,
  worktrees: [],
});
const snapshot = (repositories: Repository[]): Snapshot => ({
  repositories,
  events: [],
  updatedAt: new Date().toISOString(),
  scanning: false,
});

describe('saved Codex project discovery', () => {
  it('reads both desktop project formats while discarding unrelated private state', () => {
    const saved = savedCodexProjects({
      'electron-saved-workspace-roots': [
        '/fixture/atlas',
        '/fixture/relay',
        'ssh://host/project',
        1,
        'relative',
      ],
      'electron-workspace-root-labels': { '/fixture/relay': 'Relay app' },
      'local-projects': {
        a: {
          name: 'Atlas workspace',
          rootPaths: ['/fixture/atlas', '/fixture/studio'],
          secret: 'private',
        },
        invalid: { path: '/private/unselected' },
      },
      'thread-workspace-root-hints': { privateTask: '/private/unselected' },
      promptHistory: 'Private conversation',
    });
    expect(saved).toEqual([
      { path: '/fixture/atlas', name: 'Atlas workspace' },
      { path: '/fixture/relay', name: 'Relay app' },
      { path: '/fixture/studio', name: 'Atlas workspace' },
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/private|conversation/i);
    expect(() => savedCodexProjects({})).toThrow('not supported');
    expect(() => savedCodexProjects({ 'electron-saved-workspace-roots': 'invalid' })).toThrow(
      'could not be read',
    );
  });

  it('deduplicates real folders and aliases, marks missing folders, and never modifies the registry', async () => {
    const root = await directory();
    const folder = join(root, 'atlas');
    const alias = join(root, 'alias');
    await mkdir(folder);
    await symlink(folder, alias);
    const file = join(root, '.codex-global-state.json');
    const data = JSON.stringify({
      'electron-saved-workspace-roots': [folder, alias, join(root, 'missing')],
    });
    await writeFile(file, data);
    const projects = await readCodexProjects(root);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.available)).toEqual([true, false]);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(file, 'utf8')).toBe(data);
    await writeFile(file, '{unfinished save');
    await expect(readCodexProjects(root)).rejects.toThrow('could not be read');
    expect(await readCodexProjects(join(root, 'no-codex'))).toEqual([]);
  });
  it('searches project names and paths with multiple terms and normalized Unicode', () => {
    const value = { name: 'Atlas API', path: '/projects/Café/backend' };
    expect(projectMatches(value, '  atlas BACKEND ')).toBe(true);
    expect(projectMatches(value, 'cafe\u0301')).toBe(true);
    expect(projectMatches(value, 'atlas frontend')).toBe(false);
  });

  it('rejects oversized combined registries instead of silently dropping projects', () => {
    const paths = Array.from({ length: 5000 }, (_, index) => `/fixture/${index}`);
    const saved = {
      'electron-saved-workspace-roots': paths,
      'local-projects': {
        duplicate: { name: 'Updated label', rootPaths: [paths[0]] },
      },
    };
    expect(savedCodexProjects(saved)[0].name).toBe('Updated label');
    expect(() =>
      savedCodexProjects({
        ...saved,
        'local-projects': {
          extra: { name: 'Extra project', rootPaths: ['/fixture/extra'] },
        },
      }),
    ).toThrow('Too many');
    expect(() =>
      savedCodexProjects({
        'local-projects': Object.fromEntries(
          Array.from({ length: 5001 }, (_, index) => [index, { name: 'Project', rootPaths: [] }]),
        ),
      }),
    ).toThrow('could not be read');
  });
});

async function fixture(
  read: () => Promise<DiscoveredProject[]>,
  initial: Repository[] = [],
  scan = vi.fn(async (path: string) => repo(path)),
) {
  const root = await directory();
  const store = new AppStore(root);
  cleanup.push(() => store.close());
  store.write('snapshot', snapshot(initial));
  const repositories = new RepositoryService(
    store,
    vi.fn(),
    { executable: async () => '/fixture/git' },
    { scan, close: vi.fn() },
  );
  cleanup.push(() => repositories.close());
  const discovery = new ProjectDiscoveryService(store, repositories, vi.fn(), read);
  cleanup.push(() => discovery.close());
  const remove = () =>
    stopMonitoring(
      'atlas',
      repositories,
      { enrich: (s) => s, prepareForgetUnselected: () => () => {} },
      { prepareForgetUnselected: () => () => {} },
      { prepareForgetUnselected: () => () => {} },
      discovery,
    );
  return { store, repositories, discovery, remove, scan };
}

describe('following discovered projects', () => {
  it('rotates bounded imports so unavailable Git folders do not starve later projects', async () => {
    const roots = Array.from({ length: 55 }, (_, index) => project(`/fixture/${index}`));
    const scan = vi.fn(async (path: string) => {
      if (Number(path.split('/').at(-1)) < 24) throw new Error('Not Git');
      return { ...repo(path), id: path };
    });
    const f = await fixture(async () => roots, [], scan);
    await f.discovery.setEnabled(true);
    expect(scan).toHaveBeenCalledTimes(24);
    expect(f.discovery.state()).toMatchObject({ failedCount: 24, pendingCount: 31 });
    await f.discovery.refresh();
    expect(f.repositories.current().repositories).toHaveLength(24);
    expect(f.discovery.state()).toMatchObject({ failedCount: 0, pendingCount: 31 });
    await f.discovery.refresh();
    expect(scan).toHaveBeenCalledTimes(72);
    expect(f.repositories.current().repositories).toHaveLength(31);
    expect(f.repositories.current().repositories.at(-1)?.path).toBe('/fixture/54');
  });

  it.each(['invalid value', 'invalid JSON', 'null value'])(
    'pauses following on %s in saved exclusions until explicitly reset',
    async (failure) => {
      const f = await fixture(async () => [project()]);
      f.discovery.close();
      f.store.write('discovery.codex.enabled', true);
      f.store.write('discovery.excluded', failure === 'null value' ? null : 'unreadable');
      const original = f.store.readStrict.bind(f.store);
      const read = vi.spyOn(f.store, 'readStrict').mockImplementation((key) => {
        if (failure === 'invalid JSON' && key === 'discovery.excluded')
          throw new SyntaxError('Malformed JSON');
        return original(key);
      });
      const next = new ProjectDiscoveryService(f.store, f.repositories, vi.fn(), async () => [
        project(),
      ]);
      cleanup.push(() => next.close());
      await next.refresh();
      expect(next.state()).toMatchObject({ enabled: false, recoveryNeeded: true });
      expect(f.scan).not.toHaveBeenCalled();
      expect(() => next.setEnabled(true)).toThrow('Reset removed-project choices');
      read.mockRestore();
      await next.restore();
      expect(next.state()).toMatchObject({ enabled: true, recoveryNeeded: false });
      expect(f.repositories.current().repositories).toHaveLength(1);
    },
  );

  it('discovers without scanning until enabled, follows additions, and preserves projects after disabling or source changes', async () => {
    let roots = [project()];
    const f = await fixture(async () => roots);
    await f.discovery.refresh();
    expect(f.discovery.state().projects).toHaveLength(1);
    expect(f.scan).not.toHaveBeenCalled();
    await f.discovery.setEnabled(true);
    expect(f.repositories.current().repositories).toHaveLength(1);
    roots = [];
    await f.discovery.refresh();
    await f.discovery.setEnabled(false);
    expect(f.repositories.current().repositories).toHaveLength(1);
    expect(f.store.read('discovery.codex.enabled', true)).toBe(false);
  });

  it('preserves an existing primary folder when Codex saved another root in the same worktree family', async () => {
    const existing = repo('/fixture/primary');
    const f = await fixture(async () => [project('/fixture/linked-worktree')], [existing]);
    await f.discovery.setEnabled(true);
    expect(f.repositories.current().repositories).toHaveLength(1);
    expect(f.repositories.current().repositories[0].path).toBe('/fixture/primary');
  });

  it('does not re-add a removed project when an older discovery scan finishes or after restart', async () => {
    let finish!: (repository: Repository) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const scan = vi.fn(() => {
      entered();
      return new Promise<Repository>((resolve) => {
        finish = resolve;
      });
    });
    const f = await fixture(
      async () => [project('/fixture/linked-worktree')],
      [repo('/fixture/primary')],
      scan,
    );
    const following = f.discovery.setEnabled(true);
    await started;
    f.remove();
    finish(repo('/fixture/linked-worktree'));
    await following;
    expect(f.repositories.current().repositories).toHaveLength(0);
    expect(f.store.read('discovery.excluded', [])).toEqual(['atlas']);
    f.discovery.close();
    scan.mockImplementation(async () => repo());
    const next = new ProjectDiscoveryService(f.store, f.repositories, vi.fn(), async () => [
      project(),
    ]);
    cleanup.push(() => next.close());
    await next.refresh();
    expect(f.repositories.current().repositories).toHaveLength(0);
    await next.restore();
    expect(f.repositories.current().repositories).toHaveLength(1);
  });

  it('rolls back removal and its exclusion together when saving the discovery choice fails', async () => {
    const f = await fixture(async () => [], [repo()]);
    const original = f.store.write.bind(f.store);
    const write = vi.spyOn(f.store, 'write').mockImplementation((key, value) => {
      if (key === 'discovery.excluded') throw new Error('Fixture storage failure');
      original(key, value);
    });
    expect(f.remove).toThrow('Fixture storage failure');
    expect(f.repositories.current().repositories).toHaveLength(1);
    expect(f.store.snapshot().repositories).toHaveLength(1);
    expect(f.discovery.state().excludedCount).toBe(0);
    write.mockRestore();
    f.remove();
    expect(f.repositories.current().repositories).toHaveLength(0);
    expect(f.discovery.state().excludedCount).toBe(1);
  });

  it('rejects a discovery scan that completes after following is disabled', async () => {
    let finish!: (repository: Repository) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await fixture(
      async () => [project()],
      [],
      vi.fn(() => {
        entered();
        return new Promise<Repository>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const following = f.discovery.setEnabled(true);
    await started;
    const disabled = f.discovery.setEnabled(false);
    finish(repo());
    await following;
    await disabled;
    expect(f.repositories.current().repositories).toHaveLength(0);
  });

  it('keeps discovered and monitored projects after an unavailable source and counts non-Git folders separately', async () => {
    let failed = false;
    const f = await fixture(async () => {
      if (failed) throw new Error('private filename');
      return [project()];
    });
    await f.discovery.setEnabled(true);
    failed = true;
    await f.discovery.refresh();
    expect(f.discovery.state()).toMatchObject({
      projects: [project()],
      error: expect.stringContaining('Could not refresh'),
    });
    expect(JSON.stringify(f.discovery.state())).not.toContain('private filename');
    expect(f.repositories.current().repositories).toHaveLength(1);
    const invalid = await fixture(
      async () => [project()],
      [],
      vi.fn(async () => {
        throw new Error('Not Git');
      }),
    );
    await invalid.discovery.setEnabled(true);
    expect(invalid.discovery.state().failedCount).toBe(1);
    expect(invalid.repositories.current().repositories).toHaveLength(0);
  });
});
