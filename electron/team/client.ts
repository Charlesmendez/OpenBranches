import { z } from 'zod';
import {
  teamId,
  pairingStartSchema,
  sharingChangeSchema,
  publishSchema,
} from '../../src/team/protocol';
import {
  deviceSecret,
  pairingResponse,
  pairingPollResponse,
  companionResponse,
  sharingChangedResponse,
  snapshotPublishedResponse,
} from '../../src/team/device';
import { readTeamResponse, TeamApiError } from '../../src/team/readResponse';
import { teamOrigin } from './origin';
export class TeamDeviceClient {
  readonly origin: string;
  constructor(
    origin: string,
    private token?: string,
    private request: typeof fetch = fetch,
    private options: { allowLoopback?: boolean; signal?: AbortSignal } = {},
  ) {
    this.origin = teamOrigin(origin, options.allowLoopback);
    if (token) deviceSecret.parse(token);
  }
  private async json<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    value?: unknown,
    additionalSignal?: AbortSignal,
  ): Promise<T> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(this.options.signal ? [this.options.signal] : []),
      ...(additionalSignal ? [additionalSignal] : []),
    ]);
    let response: Response;
    try {
      response = await this.request(new URL(path, this.origin), {
        method,
        signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}),
          ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
    } catch {
      throw new Error(
        'Could not reach the team service. Check the address and your connection, then retry.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const messages: Record<number, string> = {
        401: 'This device no longer has access. Reconnect it or ask the workspace owner for help.',
        403: 'This account cannot perform that team action.',
        409: 'The team connection changed. Retry the action.',
        410: 'The connection code expired or was cancelled.',
        429: 'The team service asked this Mac to wait before trying again.',
      };
      throw new TeamApiError(
        response.status,
        'team_request_failed',
        messages[response.status] ?? 'The team service could not complete the request. Try again.',
      );
    }
    return readTeamResponse(response, schema, 2_000_000);
  }
  begin(deviceName: string) {
    return this.json(
      '/api/pairings',
      pairingResponse,
      'POST',
      pairingStartSchema.parse({ deviceName }),
    );
  }
  poll() {
    return this.json('/api/pairings/current', pairingPollResponse);
  }
  cancel() {
    return this.json(
      '/api/pairings/cancel',
      z.strictObject({ cancelled: z.literal(true) }),
      'POST',
    );
  }
  companion(workspace: string) {
    return this.json(
      '/api/workspaces/' + teamId.parse(workspace) + '/companion',
      companionResponse,
    );
  }
  async changeSharing(workspace: string, project: string, input: unknown, signal?: AbortSignal) {
    const command = sharingChangeSchema.parse(input);
    const result = await this.json(
      '/api/workspaces/' + teamId.parse(workspace) + '/shares/' + teamId.parse(project),
      sharingChangedResponse,
      'PUT',
      command,
      signal,
    );
    const consent = command.enabled ? command.consent : { taskTitles: false, taskSummaries: false };
    if (
      result.projectId !== project ||
      result.epoch !== command.expectedEpoch + 1 ||
      result.sequence !== 0 ||
      result.enabled !== command.enabled ||
      result.consent.taskTitles !== consent.taskTitles ||
      result.consent.taskSummaries !== consent.taskSummaries
    )
      throw new Error(
        'The team did not confirm this project and its sharing choices. Refresh and retry.',
      );
    return result;
  }
  publishSnapshot(workspace: string, project: string, input: unknown, signal?: AbortSignal) {
    return this.json(
      '/api/workspaces/' +
        teamId.parse(workspace) +
        '/shares/' +
        teamId.parse(project) +
        '/snapshots',
      snapshotPublishedResponse,
      'POST',
      publishSchema.parse(input),
      signal,
    );
  }
  revoke(workspace: string, device: string) {
    return this.json(
      '/api/workspaces/' + teamId.parse(workspace) + '/devices/' + teamId.parse(device),
      z.strictObject({ revision: z.string().regex(/^\d+$/) }),
      'DELETE',
    );
  }
}
