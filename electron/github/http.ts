import { z } from 'zod';

import { GitHubTransport, type Fetch } from '../../src/github/transport';
export { GitHubError, type Fetch } from '../../src/github/transport';

/** Desktop callers receive only GET access. */
export class GitHubHttp {
  private transport: GitHubTransport;
  constructor(
    private token: () => Promise<string | undefined>,
    request: Fetch = fetch,
  ) {
    this.transport = new GitHubTransport(request);
  }
  async get(path: string, options: { etag?: string } = {}) {
    return this.transport.json(path, this.token, options);
  }
  resetBackoff() {
    this.transport.resetBackoff();
  }
}

const oauthError = z.object({ error: z.string(), interval: z.number().optional() });
export async function oauthRequest(
  path: 'device/code' | 'oauth/access_token',
  values: Record<string, string>,
  request: Fetch = fetch,
): Promise<unknown> {
  const response = await request(`https://github.com/login/${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`GitHub sign-in is unavailable (${response.status}). Try again.`);
  const body: unknown = await response.json();
  const failure = oauthError.safeParse(body);
  if (failure.success && !['authorization_pending', 'slow_down'].includes(failure.data.error)) {
    const messages: Record<string, string> = {
      access_denied: 'GitHub authorization was cancelled.',
      expired_token: 'The sign-in code expired. Start again.',
      bad_refresh_token: 'GitHub sign-in expired. Reconnect your account.',
      device_flow_disabled: 'This GitHub App has not enabled device sign-in.',
      incorrect_client_credentials: 'This build needs a valid GitHub App client ID.',
    };
    throw new Error(
      messages[failure.data.error] ?? 'GitHub could not complete sign-in. Start again.',
    );
  }
  return body;
}
