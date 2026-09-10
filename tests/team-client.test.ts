import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TeamClient } from '../src/team/client';
import { teamViewSchema } from '../src/team/responses';
const workspace = randomUUID(),
  person = randomUUID(),
  project = randomUUID();
const page = () => ({
  workspace: { id: workspace, name: 'Fictional team', revision: '1' },
  people: [],
  projects: [],
  work: [],
  checkedAt: new Date().toISOString(),
  coverage: { people: true, projects: true },
  nextCursor: null,
  totals: { people: 0, projects: 0, reports: 0, snapshots: 0, stale: 0, omitted: 0 },
});
describe('team browser client boundary', () => {
  it('rejects GitHub setup responses for another workspace and unsafe authorization destinations', async () => {
    const wrong = new TeamClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ workspaceId: randomUUID(), configured: true, selections: [] }),
        ),
    );
    await expect(wrong.githubState(workspace)).rejects.toThrow('does not match');
    for (const url of [
      'https://elsewhere.invalid/login/oauth/authorize',
      'https://github.com/settings',
      'https://user@github.com/login/oauth/authorize',
    ]) {
      const client = new TeamClient(vi.fn().mockResolvedValue(Response.json({ url })));
      await expect(client.githubAuthorize(workspace)).rejects.toThrow('unsupported response');
    }
  });
  it('binds a GitHub catalog to its exact workspace, authority review and installation', async () => {
    const proofId = randomUUID(),
      value = {
        id: randomUUID(),
        workspaceId: workspace,
        proofId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        installation: {
          installationId: '31',
          accountId: '41',
          accountType: 'Organization',
          accountLogin: 'FictionalOrg',
        },
        projects: [],
        complete: true,
        total: 0,
      };
    const good = new TeamClient(vi.fn().mockResolvedValue(Response.json(value)));
    expect((await good.githubCatalog(workspace, proofId, '31')).id).toBe(value.id);
    await expect(
      new TeamClient(
        vi.fn().mockResolvedValue(Response.json({ ...value, proofId: randomUUID() })),
      ).githubCatalog(workspace, proofId, '31'),
    ).rejects.toThrow('does not match');
    await expect(
      new TeamClient(vi.fn().mockResolvedValue(Response.json(value))).githubCatalog(
        workspace,
        proofId,
        '32',
      ),
    ).rejects.toThrow('does not match');
  });
  it('binds the browser fetch receiver and scopes encoded filters to the team API', async () => {
    const request = vi.fn<typeof fetch>(function (this: unknown, url, options) {
      expect(this).toBe(globalThis);
      expect(String(url)).toContain('/api/workspaces/' + workspace + '/view?');
      expect(options?.credentials).toBe('same-origin');
      expect(options?.redirect).toBe('error');
      expect(options?.cache).toBe('no-store');
      return Promise.resolve(Response.json(page()));
    });
    const client = new TeamClient(request);
    await client.view(workspace, { person, project, query: 'name%_ / https://elsewhere.invalid' });
    const params = new URL('http://fixture.invalid' + String(request.mock.calls[0][0]))
      .searchParams;
    expect(params.get('member')).toBe(person);
    expect(params.get('project')).toBe(project);
    expect(params.get('q')).toBe('name%_ / https://elsewhere.invalid');
  });
  it('invalidates the matching access scope on unauthorized responses', async () => {
    const changed = vi.fn(),
      client = new TeamClient(
        vi.fn().mockResolvedValue(Response.json({ message: 'PRIVATE' }, { status: 401 })),
        changed,
      );
    await expect(client.view(workspace)).rejects.toMatchObject({
      status: 401,
      code: 'sign_in_required',
    });
    expect(changed).toHaveBeenCalledWith('/api/workspaces/' + workspace + '/view?');
    client.accessChanged();
    expect(changed).toHaveBeenLastCalledWith('/api/workspaces');
  });
  it('rejects malformed or oversized responses and never trusts unsupported fields', async () => {
    expect(teamViewSchema.safeParse({ ...page(), token: 'PRIVATE' }).success).toBe(false);
    const malformed = new TeamClient(
      vi.fn().mockResolvedValue(Response.json({ ...page(), totals: { reports: -1 } })),
    );
    await expect(malformed.view(workspace)).rejects.toThrow('unsupported response');
    const oversized = new TeamClient(
      vi.fn().mockResolvedValue(new Response('x'.repeat(8_000_001))),
    );
    await expect(oversized.view(workspace)).rejects.toThrow('too large');
  });
  it('rejects arbitrary workspace paths before making a request', () => {
    const request = vi.fn(),
      client = new TeamClient(request);
    expect(() => client.view('https://elsewhere.invalid/')).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a response from a different workspace instead of displaying it', async () => {
    const value = page();
    value.workspace.id = randomUUID();
    const client = new TeamClient(vi.fn().mockResolvedValue(Response.json(value)));
    await expect(client.view(workspace)).rejects.toThrow('does not match the selected workspace');
  });
});
