import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TeamGitHubApp } from '../src/github/app';
import type { InstallationBinding } from '../src/github/schema';

// Keys are generated only in memory. No real GitHub app or credentials used.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const binding: InstallationBinding = {
  installationId: '31',
  accountId: '41',
  accountType: 'Organization',
};
const permissions = {
  metadata: 'read',
  contents: 'read',
  pull_requests: 'read',
  checks: 'read',
  statuses: 'read',
};
const owner = { id: 41, login: 'FictionalOrg', type: 'Organization' };
const repository = {
  id: 51,
  name: 'work',
  full_name: 'FictionalOrg/work',
  owner,
  private: true,
  archived: false,
  default_branch: 'develop',
};
const installation = {
  id: 31,
  account: owner,
  suspended_at: null,
  permissions,
  client_id: 'fixture-client',
};
const mainSha = 'a'.repeat(40),
  branchSha = 'b'.repeat(40);
const response = (body: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { headers });
type Intercept = (
  path: string,
  options: RequestInit | undefined,
  count: number,
) => Response | undefined | Promise<Response | undefined>;
function fixture(intercept?: Intercept) {
  const counts = new Map<string, number>();
  const request = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const address = new URL(String(url)),
      path = address.pathname + address.search;
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    const custom = await intercept?.(path, options, count);
    if (custom) return custom;
    if (path === '/app/installations/31') return response(installation);
    if (path === '/app/installations/31/access_tokens')
      return response({
        token: 'fictional-installation-token',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        permissions: JSON.parse(String(options?.body)).permissions,
      });
    if (path.startsWith('/installation/repositories?'))
      return response({ total_count: 1, repositories: [repository] });
    if (path === '/repos/FictionalOrg/work') return response(repository);
    if (path.includes('/branches?'))
      return response([
        { name: 'develop', commit: { sha: mainSha } },
        { name: 'feature/shared', commit: { sha: branchSha } },
      ]);
    if (path.includes('/pulls?'))
      return response(
        path.includes('state=open')
          ? [
              {
                number: 1,
                title: 'Fictional PR',
                state: 'open',
                draft: false,
                merged_at: null,
                updated_at: new Date().toISOString(),
                user: { id: 61, login: 'fictional-person', type: 'User' },
                base: { ref: 'develop' },
                head: {
                  ref: 'feature/shared',
                  sha: branchSha,
                  repo: { full_name: repository.full_name },
                },
                body: 'PRIVATE_BODY',
              },
            ]
          : [],
      );
    if (path.includes('/check-runs?'))
      return response({
        total_count: 1,
        check_runs: [
          {
            id: 71,
            name: 'Build',
            head_sha: branchSha,
            status: 'completed',
            conclusion: 'failure',
            output: { text: 'PRIVATE_LOG' },
          },
        ],
      });
    if (path.includes('/status?'))
      return response({ sha: branchSha, total_count: 0, statuses: [] });
    if (path.includes('/reviews?')) return response([]);
    if (path.includes('/compare/'))
      return response({
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        base_commit: { sha: mainSha },
        merge_base_commit: { sha: mainSha },
        files: [{ patch: 'PRIVATE_PATCH' }],
      });
    throw new Error('Unexpected fictional route: ' + path);
  });
  return { app: new TeamGitHubApp('fixture-client', pem, request), request, counts };
}

describe('GitHub App installation reader', () => {
  it('signs verifiable short-lived JWTs, narrows one repository and reuses normalized PR/check/ancestry evidence', async () => {
    const f = fixture();
    const result = await f.app.read(binding, '51');
    expect(result.project).toMatchObject({ id: '51', accountId: '41', private: true });
    expect(result.snapshot.branches).toHaveLength(2);
    expect(result.snapshot.pulls[0]).toMatchObject({
      author: { id: '61', login: 'fictional-person' },
      signals: { checks: { counts: { failed: 1 } } },
    });
    expect(result.snapshot.history?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchSha,
          targetSha: mainSha,
          state: 'pending',
          source: 'github',
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_|fictional-installation-token|Bearer|private_key/,
    );
    const mutation = f.request.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(mutation).toHaveLength(1);
    expect(new URL(String(mutation[0][0])).pathname).toBe('/app/installations/31/access_tokens');
    expect(JSON.parse(String(mutation[0][1]?.body))).toEqual({ repository_ids: [51], permissions });
    for (const [url, options] of f.request.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://api.github.com');
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
      const authorization = new Headers(options?.headers).get('Authorization')!;
      if (String(url).includes('/app/installations/')) {
        const jwt = authorization.slice(7),
          [header, claims, signature] = jwt.split('.');
        expect(
          verify(
            'RSA-SHA256',
            Buffer.from(header + '.' + claims),
            keys.publicKey,
            Buffer.from(signature, 'base64url'),
          ),
        ).toBe(true);
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
          alg: 'RS256',
          typ: 'JWT',
        });
        const body = JSON.parse(Buffer.from(claims, 'base64url').toString());
        expect(body.iss).toBe('fixture-client');
        expect(body.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(540);
        expect(body.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) - 60);
      } else expect(authorization).toBe('Bearer fictional-installation-token');
    }
    expect(f.counts.get('/app/installations/31')).toBe(2);
    expect(f.counts.get('/repos/FictionalOrg/work')).toBe(2);
  });
  it('rejects changed installation identity, another client, suspension and missing permissions before minting', async () => {
    for (const change of [
      { id: 32 },
      { account: { ...owner, id: 99 } },
      { account: { ...owner, type: 'User' } },
      { client_id: 'another-app' },
      { suspended_at: new Date().toISOString() },
      { permissions: { metadata: 'read' } },
    ]) {
      const f = fixture((path) =>
        path === '/app/installations/31' ? response({ ...installation, ...change }) : undefined,
      );
      await expect(f.app.read(binding, '51')).rejects.toThrow();
      expect(f.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    }
  });
  it('rejects broader or missing token permissions and invalid expiration without using the returned token', async () => {
    for (const change of [
      { permissions: { ...permissions, contents: 'write' } },
      { permissions: { ...permissions, issues: 'read' } },
      { permissions: { ...permissions, constructor: 'read' } },
      { permissions: { metadata: 'read' } },
      { expires_at: new Date(Date.now() - 1).toISOString() },
    ]) {
      const f = fixture((path) =>
        path.endsWith('/access_tokens')
          ? response({
              token: 'unusable-secret',
              permissions,
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
              ...change,
            })
          : undefined,
      );
      await expect(f.app.read(binding, '51')).rejects.toThrow();
      expect(
        f.request.mock.calls.some(
          ([, options]) =>
            new Headers(options?.headers).get('Authorization') === 'Bearer unusable-secret',
        ),
      ).toBe(false);
    }
  });
  it('rejects an overbroad token repository list, transferred repository and reused name before reading work', async () => {
    for (const repositories of [
      [repository, { ...repository, id: 52 }],
      [{ ...repository, id: 52 }],
      [{ ...repository, owner: { ...owner, id: 42 } }],
    ]) {
      const f = fixture((path) =>
        path.startsWith('/installation/repositories?')
          ? response({ total_count: repositories.length, repositories })
          : undefined,
      );
      await expect(f.app.read(binding, '51')).rejects.toThrow();
      expect(f.request.mock.calls.some(([url]) => String(url).includes('/branches?'))).toBe(false);
    }
    const f = fixture((path) =>
      path === '/repos/FictionalOrg/work' ? response({ ...repository, id: 52 }) : undefined,
    );
    await expect(f.app.read(binding, '51')).rejects.toThrow('changed');
  });
  it('discards completed work when the repository or installation changes during the read', async () => {
    for (const target of ['repository', 'installation', 'permissions']) {
      const f = fixture((path, _, count) =>
        count === 2 &&
        path === (target === 'repository' ? '/repos/FictionalOrg/work' : '/app/installations/31')
          ? response(
              target === 'repository'
                ? { ...repository, id: 99 }
                : target === 'permissions'
                  ? { ...installation, permissions: { metadata: 'read' } }
                  : { ...installation, suspended_at: new Date().toISOString() },
            )
          : undefined,
      );
      await expect(f.app.read(binding, '51')).rejects.toThrow();
      expect(f.request.mock.calls.some(([url]) => String(url).includes('/pulls?'))).toBe(true);
    }
  });
  it('checks cancellation after token creation and drops late data without continuing', async () => {
    let current = true;
    const f = fixture((path) => {
      if (path.endsWith('/access_tokens')) current = false;
      return undefined;
    });
    await expect(f.app.read(binding, '51', { isCurrent: () => current })).rejects.toThrow(
      'cancelled',
    );
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('retains partial PR history only for the same stable repository ID', async () => {
    const old = (await fixture().app.read(binding, '51')).snapshot;
    old.pulls = [{ ...old.pulls[0], number: 99, state: 'closed' }];
    for (const repositoryId of ['51', '999']) {
      const f = fixture((path) =>
        path.includes('/pulls?state=closed')
          ? response([], { link: '<https://api.github.com/unused>; rel="next"' })
          : undefined,
      );
      const result = await f.app.read(binding, '51', { previous: { repositoryId, snapshot: old } });
      expect(result.snapshot.pullHistoryComplete).toBe(false);
      const retained = result.snapshot.pulls.find((p) => p.number === 99);
      if (repositoryId === '51') expect(retained?.retained).toBe(true);
      else expect(retained).toBeUndefined();
    }
  });
  it('rejects branch pages beyond the provider page size before proceeding to PR reads', async () => {
    const f = fixture((path) =>
      path.includes('/branches?')
        ? response(
            Array.from({ length: 101 }, (_, i) => ({
              name: 'branch-' + i,
              commit: { sha: branchSha },
            })),
          )
        : undefined,
    );
    await expect(f.app.read(binding, '51')).rejects.toThrow();
    expect(f.request.mock.calls.some(([url]) => String(url).includes('/pulls?'))).toBe(false);
  });
  it('bounds the searchable catalog and never follows the provider pagination URL', async () => {
    const f = fixture((path) =>
      path.startsWith('/installation/repositories?')
        ? response(
            {
              total_count: 1001,
              repositories: Array.from({ length: 100 }, (_, i) => {
                const id =
                  1000 +
                  (Number(new URL('https://api.github.com' + path).searchParams.get('page')) - 1) *
                    100 +
                  i;
                return {
                  ...repository,
                  id,
                  name: 'work-' + id,
                  full_name: 'FictionalOrg/work-' + id,
                };
              }),
            },
            { link: '<https://elsewhere.example>; rel="next"' },
          )
        : undefined,
    );
    const result = await f.app.catalog(binding);
    expect(result).toMatchObject({ total: 1001, complete: false });
    expect(result.projects).toHaveLength(1000);
    expect(f.request).toHaveBeenCalledTimes(13);
    const post = f.request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ permissions: { metadata: 'read' } });
    expect(
      f.request.mock.calls.every(([url]) => String(url).startsWith('https://api.github.com/')),
    ).toBe(true);
  });
  it('marks a shrinking or duplicate repository catalog incomplete and rejects inconsistent identities', async () => {
    const f = fixture((path) =>
      path.startsWith('/installation/repositories?')
        ? response({ total_count: 2, repositories: [repository, repository] })
        : undefined,
    );
    expect(await f.app.catalog(binding)).toMatchObject({
      complete: false,
      projects: [expect.objectContaining({ id: '51' })],
    });
    const changed = fixture((path) =>
      path.startsWith('/installation/repositories?')
        ? response({
            total_count: 2,
            repositories: [
              repository,
              { ...repository, name: 'renamed', full_name: 'FictionalOrg/renamed' },
            ],
          })
        : undefined,
    );
    await expect(changed.app.catalog(binding)).rejects.toThrow('changed');
  });
  it('does not expose malformed credential contents or accept unsafe IDs and keys', async () => {
    const f = fixture((path) =>
      path.endsWith('/access_tokens')
        ? response({ token: { secret: 'PRIVATE_CREDENTIAL' } })
        : undefined,
    );
    await expect(f.app.read(binding, '51')).rejects.toThrow('unsupported installation credential');
    for (const id of ['0', '../51', '9007199254740992'])
      await expect(f.app.read(binding, id)).rejects.toThrow();
    const calls = f.request.mock.calls.length;
    await expect(f.app.read({ ...binding, accountId: 'bad' }, '51')).rejects.toThrow();
    expect(f.request).toHaveBeenCalledTimes(calls);
    expect(() => new TeamGitHubApp('fixture-client', 'private-key-text', f.request)).toThrow(
      'Configure a valid',
    );
  });
});
