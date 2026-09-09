import { z } from 'zod';

export type Fetch = typeof fetch;
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

/** Only fixed GitHub origins are allowed. Tokens never follow redirects. */
export class GitHubHttp {
  private blockedUntil = 0;
  constructor(
    private token: () => Promise<string | undefined>,
    private request: Fetch = fetch,
  ) {}

  async get(path: string): Promise<{ body: unknown; hasNext: boolean }> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub API path');
    if (Date.now() < this.blockedUntil)
      throw new GitHubError(
        'GitHub is rate limited. It will retry automatically after the limit resets.',
        429,
        this.blockedUntil,
      );
    const token = await this.token();
    const response = await this.request(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'OpenBranches',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) {
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has('retry-after') ||
            response.headers.get('x-ratelimit-remaining') === '0'))
      ) {
        const retrySeconds = Number(response.headers.get('retry-after') || 60);
        const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
        this.blockedUntil = Math.max(Date.now() + Math.max(60, retrySeconds) * 1000, reset);
        throw new GitHubError(
          'GitHub is rate limited. It will retry automatically after the limit resets.',
          response.status,
          this.blockedUntil,
        );
      }
      throw new GitHubError(
        response.status === 401
          ? 'GitHub sign-in expired. Reconnect your account.'
          : response.status === 404
            ? 'Repository unavailable on GitHub. Check the app’s repository access.'
            : `GitHub could not refresh this source (${response.status}).`,
        response.status,
      );
    }
    return {
      body: await response.json(),
      hasNext: /rel="next"/.test(response.headers.get('link') ?? ''),
    };
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
