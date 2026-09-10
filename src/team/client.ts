import { z } from 'zod';
import { teamId } from './protocol';
import {
  teamSessionSchema,
  teamViewSchema,
  teamDevicesSchema,
  projectAccessSchema,
} from './responses';
import { readTeamResponse, TeamApiError } from './readResponse';
import { githubCatalog, githubSetupState, githubNumericId, githubWorkPage } from './github';
import {
  attentionBucket,
  attentionDecisionCommand,
  attentionKind,
  attentionPage,
  type AttentionBucket,
  type AttentionDecisionCommand,
  type AttentionKind,
} from './attention';
export { TeamApiError } from './readResponse';
const changed = z.object({ revision: z.string() });
export interface TeamFilter {
  person?: string;
  project?: string;
  query?: string;
  cursor?: string;
}
export interface AttentionFilter {
  project?: string;
  query?: string;
  bucket?: AttentionBucket;
  kind?: AttentionKind;
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
  githubState(workspace: string, signal?: AbortSignal) {
    return this.json(this.root(workspace) + '/github', githubSetupState, { signal }).then((value) =>
      this.githubScope(workspace, value),
    );
  }
  githubAuthorize(workspace: string) {
    return this.json(
      this.root(workspace) + '/github/authorize',
      z.object({
        url: z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              url.origin === 'https://github.com' &&
              url.pathname === '/login/oauth/authorize' &&
              !url.username &&
              !url.password &&
              !url.hash
            );
          }),
      }),
      { method: 'POST' },
    );
  }
  githubCatalog(workspace: string, proofId: string, installationId: string) {
    return this.json(this.root(workspace) + '/github/catalog', githubCatalog, {
      method: 'POST',
      value: {
        proofId: teamId.parse(proofId),
        installationId: githubNumericId.parse(installationId),
      },
    }).then((value) => {
      this.githubScope(workspace, value);
      if (value.proofId !== proofId || value.installation.installationId !== installationId)
        throw new Error('The GitHub catalog does not match this access review.');
      return value;
    });
  }
  githubSelect(workspace: string, reviewId: string, repositoryIds: string[]) {
    return this.json(this.root(workspace) + '/github/select', changed, {
      method: 'POST',
      value: { reviewId: teamId.parse(reviewId), repositoryIds },
    });
  }
  githubRemove(workspace: string, project: string) {
    return this.json(this.root(workspace) + '/github/projects/' + teamId.parse(project), changed, {
      method: 'DELETE',
    });
  }
  githubWork(workspace: string, filter: TeamFilter = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (filter.person) params.set('member', teamId.parse(filter.person));
    if (filter.project) params.set('project', teamId.parse(filter.project));
    if (filter.query) params.set('q', filter.query);
    if (filter.cursor) params.set('cursor', teamId.parse(filter.cursor));
    return this.json(this.root(workspace) + '/github/work?' + params, githubWorkPage, {
      signal,
    }).then((value) => {
      this.githubScope(workspace, value);
      if (value.sources.some((source) => filter.project && source.projectId !== filter.project))
        throw new Error('The GitHub response does not match the selected project.');
      return value;
    });
  }
  attention(workspace: string, filter: AttentionFilter = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (filter.project) params.set('project', teamId.parse(filter.project));
    if (filter.query) params.set('q', filter.query);
    if (filter.bucket) params.set('bucket', attentionBucket.parse(filter.bucket));
    if (filter.kind) params.set('kind', attentionKind.parse(filter.kind));
    return this.json(this.root(workspace) + '/attention?' + params, attentionPage, { signal }).then(
      (value) => {
        this.githubScope(workspace, value);
        if (
          (filter.bucket && value.bucket !== filter.bucket) ||
          value.items.some(
            (item) =>
              (filter.project && item.projectId !== filter.project) || item.state !== value.bucket,
          )
        )
          throw new Error('The attention response does not match the selected queue or project.');
        return value;
      },
    );
  }
  decideAttention(workspace: string, command: AttentionDecisionCommand) {
    return this.json(this.root(workspace) + '/attention/decisions', changed, {
      method: 'POST',
      value: attentionDecisionCommand.parse(command),
    });
  }
  private githubScope<T extends { workspaceId: string }>(workspace: string, value: T): T {
    if (value.workspaceId !== workspace)
      throw new Error('The GitHub response does not match the selected workspace.');
    return value;
  }
}
