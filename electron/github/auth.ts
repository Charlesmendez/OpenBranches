import { z } from 'zod';
import type { GitHubStatus } from '../../src/domain/types';
import { GitHubHttp, oauthRequest, type Fetch } from './http';

export interface TokenVault {
  read(): string | undefined;
  write(value: string | undefined): void;
}
const credentialsSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number().optional(),
  refreshToken: z.string().optional(),
  clientId: z.string(),
  login: z.string(),
});
const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().optional(),
});
const deviceSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.literal('https://github.com/login/device'),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
});
type Credentials = z.infer<typeof credentialsSchema>;

export class GitHubAuth {
  private credentials?: Credentials;
  private pending?: z.infer<typeof deviceSchema> & { expiresAt: number; pollAt: number };
  private refreshing?: Promise<string | undefined>;
  private generation = 0;
  private error?: string;
  private polling = false;
  readonly http: GitHubHttp;

  constructor(
    private clientId: string,
    private vault: TokenVault,
    private request: Fetch = fetch,
  ) {
    try {
      const saved = vault.read();
      if (saved) this.credentials = credentialsSchema.parse(JSON.parse(saved));
    } catch {
      this.error = 'Saved GitHub sign-in could not be opened. Reconnect your account.';
    }
    this.http = new GitHubHttp(() => this.token(), request);
  }

  status(): GitHubStatus {
    if (this.pending && this.pending.expiresAt <= Date.now()) {
      this.pending = undefined;
      this.error = 'The sign-in code expired. Start again.';
    }
    return {
      connected: !!this.credentials,
      configured: !!this.clientId,
      login: this.credentials?.login,
      error: this.error,
      device: this.pending && {
        code: this.pending.user_code,
        verificationUrl: this.pending.verification_uri,
        expiresAt: this.pending.expiresAt,
      },
    };
  }

  async begin(): Promise<GitHubStatus> {
    if (!this.clientId)
      throw new Error('This development build needs the release GitHub App client ID.');
    const generation = ++this.generation;
    this.error = undefined;
    this.pending = undefined;
    const device = deviceSchema.parse(
      await oauthRequest('device/code', { client_id: this.clientId }, this.request),
    );
    if (generation !== this.generation) return this.status();
    this.pending = {
      ...device,
      interval: Math.max(5, device.interval),
      expiresAt: Date.now() + device.expires_in * 1000,
      pollAt: Date.now() + Math.max(5, device.interval) * 1000,
    };
    return this.status();
  }

  async poll(): Promise<GitHubStatus> {
    const pending = this.pending;
    if (!pending || this.polling || Date.now() < pending.pollAt || Date.now() >= pending.expiresAt)
      return this.status();
    const generation = this.generation;
    this.polling = true;
    pending.pollAt = Date.now() + pending.interval * 1000;
    try {
      const body = await oauthRequest(
        'oauth/access_token',
        {
          client_id: this.clientId,
          device_code: pending.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        this.request,
      );
      if (generation !== this.generation) return this.status();
      const token = tokenSchema.safeParse(body);
      if (token.success) {
        const client = new GitHubHttp(async () => token.data.access_token, this.request);
        const { login } = z.object({ login: z.string() }).parse((await client.get('/user')).body);
        if (generation === this.generation) {
          this.save({ ...this.fromToken(token.data), clientId: this.clientId, login });
          this.pending = undefined;
        }
      } else {
        const waiting = z
          .object({ error: z.string(), interval: z.number().positive().optional() })
          .parse(body);
        if (waiting.error === 'slow_down') {
          pending.interval = Math.max(pending.interval + 5, waiting.interval ?? 0);
          pending.pollAt = Date.now() + pending.interval * 1000;
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.error = error instanceof Error ? error.message : 'GitHub sign-in failed.';
        this.pending = undefined;
      }
    } finally {
      this.polling = false;
    }
    return this.status();
  }

  disconnect() {
    ++this.generation;
    this.pending = undefined;
    this.credentials = undefined;
    this.error = undefined;
    this.vault.write(undefined);
    this.http.resetBackoff();
  }

  private token(): Promise<string | undefined> {
    if (!this.credentials) return Promise.resolve(undefined);
    if (!this.credentials.expiresAt || this.credentials.expiresAt > Date.now() + 60_000)
      return Promise.resolve(this.credentials.accessToken);
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshToken().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async refreshToken(): Promise<string | undefined> {
    const saved = this.credentials!;
    const generation = this.generation;
    if (!saved.refreshToken) throw new Error('GitHub sign-in expired. Reconnect your account.');
    const token = tokenSchema.parse(
      await oauthRequest(
        'oauth/access_token',
        {
          client_id: saved.clientId,
          grant_type: 'refresh_token',
          refresh_token: saved.refreshToken,
        },
        this.request,
      ),
    );
    if (generation !== this.generation) throw new Error('GitHub connection changed.');
    this.save({ ...this.fromToken(token), clientId: saved.clientId, login: saved.login });
    return token.access_token;
  }
  private fromToken(token: z.infer<typeof tokenSchema>) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    };
  }
  private save(credentials: Credentials) {
    this.vault.write(JSON.stringify(credentials));
    this.credentials = credentials;
    this.error = undefined;
    this.http.resetBackoff();
  }
}
