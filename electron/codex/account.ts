import { z } from 'zod';
import type { CodexAccount, CodexUsageBucket } from '../../src/domain/types';
import type { CodexInspectionClient } from './transport';
import { ADVISOR_POLICY } from '../advisor/policy';

const windowSchema = z.object({
  usedPercent: z.number().finite().min(0),
  resetsAt: z.number().int().min(0).max(253402300799).nullish(),
  windowDurationMins: z.number().int().positive().nullish(),
});
const bucketSchema = z.object({
  limitId: z.string().max(100).nullish(),
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
  rateLimitReachedType: z.string().max(100).nullish(),
  individualLimit: z
    .object({ remainingPercent: z.number().finite(), resetsAt: z.number().int() })
    .nullish(),
});

export function parseAccountLimits(input: unknown): CodexUsageBucket[] {
  const envelope = z
    .object({
      rateLimitsByLimitId: z.record(z.string(), z.unknown()).nullish(),
      rateLimits: z.unknown().optional(),
    })
    .parse(input);
  const entries: [string, unknown][] =
    envelope.rateLimitsByLimitId != null
      ? Object.entries(envelope.rateLimitsByLimitId)
      : [['codex', envelope.rateLimits]];
  return entries.slice(0, 32).map(([id, value]) => {
    const parsed = bucketSchema.safeParse(value);
    if (!parsed.success) return { id, available: false, exhausted: false };
    const data = parsed.data;
    const bucketId = envelope.rateLimitsByLimitId == null ? (data.limitId ?? id) : id;
    const windows = [data.primary, data.secondary].filter((w) => w != null);
    return {
      id: bucketId,
      available: windows.length > 0,
      exhausted:
        !!data.rateLimitReachedType ||
        windows.some((w) => w.usedPercent >= 100) ||
        (data.individualLimit?.remainingPercent ?? 100) <= 0,
      primary: data.primary
        ? {
            usedPercent: data.primary.usedPercent,
            resetsAt: data.primary.resetsAt ?? undefined,
            windowDurationMins: data.primary.windowDurationMins ?? undefined,
          }
        : undefined,
      secondary: data.secondary
        ? {
            usedPercent: data.secondary.usedPercent,
            resetsAt: data.secondary.resetsAt ?? undefined,
            windowDurationMins: data.secondary.windowDurationMins ?? undefined,
          }
        : undefined,
    };
  });
}

export async function readCodexAccount(
  client: Pick<CodexInspectionClient, 'request'>,
): Promise<CodexAccount> {
  const checkedAt = new Date().toISOString();
  try {
    const response = z
      .object({ account: z.object({ type: z.string() }).nullish() })
      .parse(await client.request('account/read', { refreshToken: false }));
    const auth = !response.account
      ? 'signed-out'
      : response.account.type === 'chatgpt'
        ? 'chatgpt'
        : 'other';
    if (auth !== 'chatgpt') return { auth, checkedAt, limits: [] };
    try {
      const limits = parseAccountLimits(await client.request('account/rateLimits/read', {}));
      return { auth, checkedAt: new Date().toISOString(), limits };
    } catch {
      return {
        auth,
        checkedAt,
        limits: [],
        error: 'Codex usage could not be checked. Task linking is still available.',
      };
    }
  } catch {
    return {
      auth: 'unavailable',
      checkedAt,
      limits: [],
      error: 'Codex sign-in status is unavailable.',
    };
  }
}

export function accountAllowsAnalysis(
  account: CodexAccount | undefined,
  now = Date.now(),
  limitId = 'codex',
): boolean {
  if (!account || account.auth !== 'chatgpt' || account.error) return false;
  const age = now - Date.parse(account.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > ADVISOR_POLICY.maxAccountAgeMs) return false;
  const bucket = account.limits.find((value) => value.id === limitId);
  if (!bucket?.available || bucket.exhausted) return false;
  return [bucket.primary, bucket.secondary]
    .filter((w) => w != null)
    .every((window) => window.resetsAt == null || window.resetsAt * 1000 > now);
}
