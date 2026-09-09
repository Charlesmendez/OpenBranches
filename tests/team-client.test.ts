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
