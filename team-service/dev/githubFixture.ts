import { generateKeyPairSync } from 'node:crypto';
import type { InstallationBinding } from '../src/github/schema';

// Keys are generated only in memory. No real GitHub app or credentials used.
export const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const binding: InstallationBinding = {
  installationId: '31',
  accountId: '41',
  accountType: 'Organization',
};
export const permissions = {
  metadata: 'read',
  contents: 'read',
  pull_requests: 'read',
  checks: 'read',
  statuses: 'read',
};
export const owner = { id: 41, login: 'FictionalOrg', type: 'Organization' };
export const repository = {
  id: 51,
  name: 'work',
  full_name: 'FictionalOrg/work',
  owner,
  private: true,
  archived: false,
  default_branch: 'develop',
};
export const installation = {
  id: 31,
  account: owner,
  suspended_at: null,
  permissions: { ...permissions, members: 'read' },
  client_id: 'fixture-client',
};
export const mainSha = 'a'.repeat(40),
  branchSha = 'b'.repeat(40);
export const response = (body: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { headers });
export type Intercept = (
  path: string,
  options: RequestInit | undefined,
  count: number,
) => Response | undefined | Promise<Response | undefined>;
export function fictionalGitHub(intercept?: Intercept) {
  const counts = new Map<string, number>();
  const request: typeof fetch = async (url, options) => {
    const address = new URL(String(url)),
      path = address.pathname + address.search;
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    const custom = await intercept?.(path, options, count);
    if (custom) return custom;
    if (path === '/user/installations?per_page=50&page=1')
      return response({ total_count: 1, installations: [installation] });
    if (path.startsWith('/orgs/FictionalOrg/memberships/'))
      return response({ state: 'active', role: 'admin', organization: owner, user: { id: 61 } });
    if (path === '/user') return response({ id: 61, login: 'fictional-person', type: 'User' });
    if (path === '/login/oauth/access_token')
      return response({ access_token: 'fictional-user-token' });
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
  };
  return { request, counts };
}
