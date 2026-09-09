import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAuth, type TokenVault } from '../electron/github/auth';
import { GitHubHttp } from '../electron/github/http';
import { githubRepository, readRemote, type RemoteSnapshot } from '../electron/github/reader';
import { enrichRepository } from '../electron/github/enrich';
import { createDemoSnapshot } from '../src/data/demo';

const response = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });
const device = {
  device_code: 'private-device-code',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
function vault(): TokenVault {
  let value: string | undefined;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('GitHub device sign-in', () => {
  it('respects polling intervals and slow-down without exposing tokens to the UI', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(device))
      .mockResolvedValueOnce(response({ error: 'slow_down', interval: 12 }))
      .mockResolvedValueOnce(
        response({
          access_token: 'private-token',
          refresh_token: 'private-refresh',
          expires_in: 28800,
        }),
      )
      .mockResolvedValueOnce(response({ login: 'fixture-user' }));
    const storage = vault();
    const auth = new GitHubAuth('public-client-id', storage, request);
    const initial = await auth.begin();
    expect(JSON.stringify(initial)).not.toContain(device.device_code);
    await auth.poll();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await auth.poll();
    await vi.advanceTimersByTimeAsync(5000);
    await auth.poll();
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7000);
    const status = await auth.poll();
    expect(status).toMatchObject({ connected: true, login: 'fixture-user' });
    expect(JSON.stringify(status)).not.toContain('private-token');
    expect(storage.read()).toContain('private-refresh');
    expect(
      request.mock.calls.every(
        ([url]) =>
          String(url).startsWith('https://github.com/') ||
          String(url).startsWith('https://api.github.com/'),
      ),
    ).toBe(true);
    expect(request.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
  });

  it('cannot save an authorization that completed after disconnect', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(device))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const storage = vault();
    const auth = new GitHubAuth('public-client-id', storage, request);
    await auth.begin();
    await vi.advanceTimersByTimeAsync(5000);
    const poll = auth.poll();
    auth.disconnect();
    finish(response({ access_token: 'late-token' }));
    await poll;
    expect(auth.status().connected).toBe(false);
    expect(storage.read()).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('coalesces refreshes and rotates a device-flow token without a client secret', async () => {
    const storage = vault();
    storage.write(
      JSON.stringify({
        accessToken: 'old',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1,
        clientId: 'client-id',
        login: 'fixture',
      }),
    );
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/login/')
          ? response({ access_token: 'new', refresh_token: 'rotated', expires_in: 28800 })
          : response({ login: 'fixture' }),
      );
    const auth = new GitHubAuth('client-id', storage, request);
    await Promise.all([auth.http.get('/user'), auth.http.get('/user')]);
    const refreshes = request.mock.calls.filter(([url]) => String(url).includes('/login/'));
    expect(refreshes).toHaveLength(1);
    expect(String(refreshes[0][1]?.body)).not.toContain('client_secret');
    expect(storage.read()).toContain('rotated');
    auth.disconnect();
    expect(storage.read()).toBeUndefined();
  });
});

describe('remote evidence', () => {
  it('supports canonical GitHub remotes and rejects lookalike hosts', () => {
    expect(githubRepository('git@github.com:example/repo.git')).toBe('example/repo');
    expect(githubRepository('https://github.com/example/repo.git')).toBe('example/repo');
    expect(githubRepository('ssh://git@github.com/example/repo.git')).toBe('example/repo');
    expect(githubRepository('https://github.com.attacker.example/example/repo')).toBeUndefined();
    expect(githubRepository('https://github.com/example/repo/pull/4')).toBeUndefined();
  });

  it('reads every branch page and constrains PR metadata and links', async () => {
    const hash = 'a'.repeat(40);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([{ name: 'main', commit: { sha: hash } }], {
          headers: { link: '<https://api.github.com/page2>; rel="next"' },
        }),
      )
      .mockResolvedValueOnce(response([{ name: 'codex/work', commit: { sha: hash } }]))
      .mockResolvedValueOnce(
        response([
          {
            number: 1,
            title: 'Work',
            html_url: 'https://attacker.example',
            state: 'closed',
            merged_at: '2026-09-01',
            updated_at: '2026-09-01',
            body: 'Unused private PR body',
            base: { ref: 'main' },
            head: { ref: 'codex/work', sha: hash, repo: { full_name: 'example/repo' } },
          },
        ]),
      );
    const source = await readRemote(
      new GitHubHttp(async () => undefined, request),
      'example/repo',
      'origin',
    );
    expect(source.branches).toHaveLength(2);
    expect(source.branchesComplete).toBe(true);
    expect(source.pulls[0]).toMatchObject({
      state: 'merged',
      url: 'https://github.com/example/repo/pull/1',
    });
    expect(source.pulls[0]).not.toHaveProperty('body');
    expect(String(request.mock.calls[1][0])).toContain('page=2');
    expect(
      request.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('preserves local evidence but never gives a changed remote tip stale ancestry', () => {
    const repository = createDemoSnapshot().repositories[0];
    const branch = repository.branches.find((b) => b.local && b.remote)!;
    repository.branches = [branch];
    branch.integration = { develop: 'integrated', master: 'pending' };
    const source: RemoteSnapshot = {
      repository: 'example/repo',
      remoteName: branch.remote!.remote!,
      branches: [{ name: branch.remote!.name, sha: 'new-remote-tip' }],
      pulls: [],
      checkedAt: new Date().toISOString(),
      branchesComplete: true,
      pullHistoryComplete: true,
    };
    const enriched = enrichRepository(repository, [source]).branches[0];
    expect(enriched.local?.sha).toBe(branch.local?.sha);
    expect(enriched.integration.develop).toBe('integrated');
    expect(enriched.remote?.sha).toBe('new-remote-tip');
    expect(enriched.remoteIntegration?.develop).toBe('unknown');
    expect(branch.remote?.sha).not.toBe('new-remote-tip');
  });

  it('does not interpret a partial branch listing as proof of remote deletion', () => {
    const repository = createDemoSnapshot().repositories[0];
    repository.branches = [repository.branches.find((b) => b.remote)!];
    const source: RemoteSnapshot = {
      repository: 'example/repo',
      remoteName: repository.branches[0].remote!.remote!,
      branches: [],
      pulls: [],
      checkedAt: '',
      branchesComplete: false,
      pullHistoryComplete: true,
    };
    expect(enrichRepository(repository, [source]).branches[0].remote?.presence).toBe('unknown');
    source.branchesComplete = true;
    expect(enrichRepository(repository, [source]).branches[0].remote?.presence).toBe('missing');
    source.error = 'Offline';
    expect(enrichRepository(repository, [source]).branches[0].remote?.presence).toBe('unknown');
  });

  it('honors GitHub rate-limit backoff before making another request', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({}, { status: 429, headers: { 'retry-after': '120' } }));
    const http = new GitHubHttp(async () => 'token', request);
    await expect(http.get('/user')).rejects.toThrow('rate limited');
    await expect(http.get('/user')).rejects.toThrow('rate limited');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(http.get('//attacker.example')).rejects.toThrow('Invalid');
  });
});
