import { readJson } from '../shared/readJson';

export type Fetch = typeof fetch;
export interface GitHubReader {
  get(path: string): Promise<{ body: unknown; hasNext: boolean }>;
}
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
const limited = 'GitHub is rate limited. It will retry automatically after the limit resets.';

/** Fixed-origin transport shared by desktop reads and server installation
 * authentication. Callers build paths; response links are never followed. */
export class GitHubTransport {
  private blockedUntil = 0;
  constructor(private request: Fetch = fetch) {}

  resetBackoff() {
    this.blockedUntil = 0;
  }

  async json(
    path: string,
    credential?: string | (() => Promise<string | undefined>),
    options: {
      signal?: AbortSignal;
      body?: unknown;
      maxBytes?: number;
    } = {},
  ): Promise<{ body: unknown; hasNext: boolean }> {
    const url = new URL(path, 'https://api.github.com');
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      url.origin !== 'https://api.github.com' ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('Invalid GitHub API path');
    if (Date.now() < this.blockedUntil) throw new GitHubError(limited, 429, this.blockedUntil);
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    // Check the path and backoff before a desktop credential provider can
    // perform its own token refresh request.
    const token = typeof credential === 'function' ? await credential() : credential;
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await this.request(url.href, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'OpenBranches',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        signal,
        redirect: 'error',
        credentials: 'omit',
      });
    } catch {
      throw new GitHubError('GitHub could not complete this request. Refresh to retry.', 0);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has('retry-after') ||
            response.headers.get('x-ratelimit-remaining') === '0'))
      ) {
        const retry = Number(response.headers.get('retry-after') || 60);
        const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
        // Invalid or hostile headers cannot disable retries forever.
        this.blockedUntil = Math.min(
          Date.now() + 24 * 60 * 60_000,
          Math.max(
            Date.now() + (Number.isFinite(retry) ? Math.max(60, retry) : 60) * 1000,
            Number.isFinite(reset) ? reset : 0,
          ),
        );
        throw new GitHubError(limited, response.status, this.blockedUntil);
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
    try {
      const body = await readJson(response, options.maxBytes ?? 8_000_000, {
        empty: 'GitHub sent an empty response.',
        large: 'GitHub returned too much data for one request.',
        unreadable: 'GitHub sent an unreadable response.',
      });
      signal.throwIfAborted();
      return { body, hasNext: /rel="next"/.test(response.headers.get('link') ?? '') };
    } catch {
      throw new GitHubError('GitHub returned unavailable, oversized, or unexpected data.', 0);
    }
  }
}
