import { z } from 'zod';
import { teamId } from './protocol';
import {
  teamSessionSchema,
  teamViewSchema,
  teamDevicesSchema,
  projectAccessSchema,
} from './responses';
import { readTeamResponse, TeamApiError } from './readResponse';
export { TeamApiError } from './readResponse';
const changed = z.object({ revision: z.string() });
export interface TeamFilter {
  person?: string;
  project?: string;
  query?: string;
  cursor?: string;
}
export class TeamClient {
  constructor(
    private request: typeof fetch = fetch,
    private unauthorized: (path: string) => void = () => {},
  ) {}
  private async json<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; value?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await this.request.call(globalThis, path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      ...(options.value === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.value) }),
    });
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      this.unauthorized(path);
      throw new TeamApiError(401, 'sign_in_required', 'Sign in again to view this workspace.');
    }
    return readTeamResponse(response, schema);
  }
  private root(workspace: string) {
    return '/api/workspaces/' + teamId.parse(workspace);
  }
  accessChanged() {
    this.unauthorized('/api/workspaces');
  }
  session(signal?: AbortSignal) {
    return this.json('/api/session', teamSessionSchema, { signal });
  }
  signOut() {
    return this.json('/api/session', z.object({ signedOut: z.literal(true) }), {
      method: 'DELETE',
    });
  }
  createWorkspace(name: string) {
    return this.json('/api/workspaces', z.object({ id: teamId }), {
      method: 'POST',
      value: { name },
    });
  }
  view(workspace: string, filter: TeamFilter = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (filter.person) params.set('member', teamId.parse(filter.person));
    if (filter.project) params.set('project', teamId.parse(filter.project));
    if (filter.query) params.set('q', filter.query);
    if (filter.cursor) params.set('cursor', filter.cursor);
    return this.json(this.root(workspace) + '/view?' + params, teamViewSchema, { signal }).then(
      (value) => {
        if (
          value.workspace.id !== workspace ||
          value.work.some(
            (work) =>
              (filter.person && work.memberId !== filter.person) ||
              (filter.project && work.projectId !== filter.project),
          )
        )
          throw new Error('The response does not match the selected workspace or filters.');
        return value;
      },
    );
  }
  devices(workspace: string, signal?: AbortSignal) {
    return this.json(this.root(workspace) + '/devices', teamDevicesSchema, { signal });
  }
  revokeDevice(workspace: string, id: string) {
    return this.json(this.root(workspace) + '/devices/' + teamId.parse(id), changed, {
      method: 'DELETE',
    });
  }
  addMember(workspace: string, login: string) {
    return this.json(this.root(workspace) + '/members', z.object({ id: teamId }), {
      method: 'POST',
      value: { login },
    });
  }
  removeMember(workspace: string, id: string) {
    return this.json(this.root(workspace) + '/members/' + teamId.parse(id), changed, {
      method: 'DELETE',
    });
  }
  createProject(workspace: string, name: string) {
    return this.json(this.root(workspace) + '/projects', z.object({ id: teamId }), {
      method: 'POST',
      value: { name },
    });
  }
  removeProject(workspace: string, id: string) {
    return this.json(this.root(workspace) + '/projects/' + teamId.parse(id), changed, {
      method: 'DELETE',
    });
  }
  access(workspace: string, id: string, signal?: AbortSignal) {
    return this.json(
      this.root(workspace) + '/projects/' + teamId.parse(id) + '/access',
      projectAccessSchema,
      { signal },
    );
  }
  grant(workspace: string, project: string, member: string, enabled: boolean, canShare: boolean) {
    return this.json(
      this.root(workspace) +
        '/projects/' +
        teamId.parse(project) +
        '/access/' +
        teamId.parse(member),
      changed,
      { method: 'PUT', value: { enabled, canShare } },
    );
  }
  inspectPair(workspaceId: string, userCode: string) {
    return this.json('/api/pairings/inspect', z.object({ deviceName: z.string() }), {
      method: 'POST',
      value: { workspaceId: teamId.parse(workspaceId), userCode },
    });
  }
  approvePair(workspaceId: string, userCode: string) {
    return this.json('/api/pairings/approve', z.object({ deviceId: teamId }), {
      method: 'POST',
      value: { workspaceId: teamId.parse(workspaceId), userCode },
    });
  }
  eventsPath(workspace: string) {
    return this.root(workspace) + '/events';
  }
}
