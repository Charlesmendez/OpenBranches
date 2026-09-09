import { z } from 'zod';

export interface TeamConfig {
  origin: URL;
  databaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  ownerGitHubId: string;
  host: string;
  port: number;
}
export function teamConfig(env: NodeJS.ProcessEnv): TeamConfig {
  const origin = new URL(z.string().url().parse(env.OPENBRANCHES_TEAM_ORIGIN));
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
  if (
    (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('The team origin must be HTTPS, or loopback HTTP for local development.');
  const databaseUrl = z.string().min(1).parse(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol))
    throw new Error('A PostgreSQL database URL is required.');
  return {
    origin,
    databaseUrl,
    githubClientId: z.string().min(1).parse(env.GITHUB_APP_CLIENT_ID),
    githubClientSecret: z.string().min(1).parse(env.GITHUB_APP_CLIENT_SECRET),
    ownerGitHubId: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .parse(env.OPENBRANCHES_OWNER_GITHUB_ID),
    host: env.HOST ?? '127.0.0.1',
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? 4389),
  };
}
