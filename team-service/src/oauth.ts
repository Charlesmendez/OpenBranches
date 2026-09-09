import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TeamDatabase } from './db';
import type { TeamConfig } from './config';
import { TeamIdentities, githubIdentitySchema } from './identities';
import { TeamError, unauthorized } from './errors';
import { secret, secretHash, validSecret } from './secrets';

/** GitHub tokens exist only long enough to read the signed-in identity. They
 * are never returned to a device or stored as team/device credentials. */
export class TeamOAuth {
  constructor(
    private db: TeamDatabase,
    private config: TeamConfig,
    private identities: TeamIdentities,
    private request: typeof fetch = fetch,
  ) {}
  async begin() {
    const state = secret('obp'),
      browser = secret('obp'),
      verifier = secret('obp');
    await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(826041922)');
      await client.query('DELETE FROM ob_oauth_states WHERE expires_at<now()');
      const pending = await client.query<{ count: string }>(
        'SELECT count(*)::text FROM ob_oauth_states',
      );
      if (Number(pending.rows[0].count) >= 1000)
        throw new TeamError(429, 'sign_in_busy', 'Sign-in is busy. Try again shortly.');
      await client.query(
        "INSERT INTO ob_oauth_states(state_hash,browser_hash,verifier,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')",
        [secretHash(state), secretHash(browser), verifier],
      );
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.config.githubClientId,
      redirect_uri: new URL('/auth/callback', this.config.origin).href,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      allow_signup: 'false',
      prompt: 'select_account',
    }).toString();
    return { url: url.href, browser };
  }
  async complete(state: string, browser: string, code: string) {
    if (!validSecret(state) || !validSecret(browser) || !code || code.length > 1024)
      throw unauthorized();
    const found = await this.db.pool.query<{ verifier: string }>(
      'DELETE FROM ob_oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING verifier',
      [secretHash(state), secretHash(browser)],
    );
    if (!found.rows[0]) throw unauthorized();
    const exchange = await this.request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.githubClientId,
        client_secret: this.config.githubClientSecret,
        redirect_uri: new URL('/auth/callback', this.config.origin).href,
        code,
        code_verifier: found.rows[0].verifier,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!exchange.ok)
      throw new TeamError(
        502,
        'github_unavailable',
        'GitHub sign-in could not complete. Try again.',
      );
    const token = z
      .object({ access_token: z.string().min(1).max(8192) })
      .safeParse(await exchange.json());
    if (!token.success)
      throw new TeamError(
        401,
        'github_authorization',
        'GitHub did not authorize sign-in. Start again.',
      );
    const identity = await this.readIdentity('/user', token.data.access_token);
    return this.identities.signIn(identity);
  }
  async lookup(login: string) {
    const clean = z
      .string()
      .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i)
      .parse(login);
    return this.readIdentity('/users/' + encodeURIComponent(clean));
  }
  private async readIdentity(path: string, token?: string) {
    const response = await this.request('https://api.github.com' + path, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'OpenBranches-Team',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new TeamError(
        502,
        'github_unavailable',
        'GitHub could not verify this account. Try again.',
      );
    return githubIdentitySchema.parse(await response.json());
  }
}
