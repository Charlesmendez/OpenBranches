import type { PullCheck, PullSignals, SubmittedReview } from '../../src/domain/pullSignals';
import { GitHubError, type GitHubHttp } from './http';
import type { CachedPull } from './pulls';
import { parseChecks, parseReviews, parseStatuses } from './signalsSchema';

export interface SignalsBudget {
  remaining: number;
  milliseconds: number;
}
interface Page<T> {
  items: T[];
  total?: number;
}
interface Feed<T> {
  items: T[];
  observedAt: string;
  complete: boolean;
  error?: string;
}
const errorMessage = (error: unknown) =>
  error instanceof GitHubError
    ? error.message
    : 'GitHub returned unavailable or unexpected review/check data.';

/** Each endpoint gets at most two pages. No review bodies, check output, log
 * links, or arbitrary external URLs leave these whitelisted decoders. */
async function readPages<T>(
  http: Pick<GitHubHttp, 'get'>,
  path: string,
  parse: (body: unknown) => Page<T>,
  key: (item: T) => string,
  budget: SignalsBudget,
  isCurrent: () => boolean,
): Promise<Feed<T>> {
  const items = new Map<string, T>();
  let observedAt = '';
  let complete = false;
  let error: string | undefined;
  for (let page = 1; page <= 2; page++) {
    if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
    if (budget.remaining <= 0 || budget.milliseconds <= 0) break;
    budget.remaining--;
    const start = Date.now();
    try {
      const response = await http.get(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
      const parsed = parse(response.body);
      observedAt ||= new Date(start).toISOString();
      for (const item of parsed.items) items.set(key(item), item);
      if (!response.hasNext) {
        complete = parsed.total === undefined || items.size >= parsed.total;
        break;
      }
    } catch (failure) {
      if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
      error = errorMessage(failure);
      break;
    } finally {
      budget.milliseconds -= Math.max(0, Date.now() - start);
    }
  }
  return { items: [...items.values()], observedAt, complete, error };
}

function checkObservation(
  runs: Feed<PullCheck>,
  statuses: Feed<PullCheck>,
  previous?: PullSignals['checks'],
): PullSignals['checks'] {
  const error = runs.error || statuses.error;
  const times = [runs.observedAt, statuses.observedAt].filter(Boolean).sort();
  if (!times.length)
    return previous
      ? { ...previous, error: error ?? previous.error }
      : error
        ? {
            observedAt: '',
            complete: false,
            total: 0,
            counts: { failed: 0, pending: 0, passed: 0, other: 0 },
            items: [],
            error,
          }
        : undefined;
  const counts = { failed: 0, pending: 0, passed: 0, other: 0 };
  const all = [...runs.items, ...statuses.items];
  for (const item of all) counts[item.state]++;
  const rank = { failed: 0, pending: 1, other: 2, passed: 3 };
  return {
    observedAt: times[0],
    complete: runs.complete && statuses.complete,
    total: all.length,
    counts,
    items: all
      .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name))
      .slice(0, 30),
    ...(error ? { error } : {}),
  };
}
function reviewObservation(
  feed: Feed<SubmittedReview>,
  previous?: PullSignals['reviews'],
): PullSignals['reviews'] {
  if (!feed.observedAt)
    return previous
      ? { ...previous, error: feed.error ?? previous.error }
      : feed.error
        ? {
            observedAt: '',
            complete: false,
            total: 0,
            items: [],
            error: feed.error,
          }
        : undefined;
  return {
    observedAt: feed.observedAt,
    complete: feed.complete,
    total: feed.items.length,
    items: feed.items
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || Number(b.id) - Number(a.id))
      .slice(0, 30),
    ...(feed.error ? { error: feed.error } : {}),
  };
}

/** Rotate through open PRs by last attempt. Unchanged heads can reuse a recent
 * observation; changing heads immediately invalidates all old signal evidence. */
export async function readPullSignals(
  http: Pick<GitHubHttp, 'get'>,
  repository: string,
  pulls: CachedPull[],
  previous: CachedPull[],
  budget: SignalsBudget,
  isCurrent = () => true,
): Promise<CachedPull[]> {
  const cached = new Map(previous.map((pull) => [pull.number, pull]));
  const result = pulls.map((pull) => {
    const old = cached.get(pull.number);
    return { ...pull, signals: old?.signals?.headSha === pull.headSha ? old.signals : undefined };
  });
  const queue = result
    .filter(
      (pull) =>
        pull.state === 'open' &&
        /^[a-f\d]{40,64}$/.test(pull.headSha) &&
        (!pull.signals ||
          !Number.isFinite(Date.parse(pull.signals.attemptedAt)) ||
          Date.parse(pull.signals.attemptedAt) > Date.now() ||
          Date.now() - Date.parse(pull.signals.attemptedAt) >= 10 * 60_000),
    )
    .sort(
      (a, b) =>
        (a.signals?.attemptedAt ?? '').localeCompare(b.signals?.attemptedAt ?? '') ||
        a.number - b.number,
    );
  const prefix = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  for (const pull of queue) {
    if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
    if (budget.remaining < 3 || budget.milliseconds <= 0) break;
    const attemptedAt = new Date().toISOString();
    const ref = `${prefix}/commits/${pull.headSha}`;
    const runs = await readPages(
      http,
      `${ref}/check-runs?filter=latest`,
      (body) => parseChecks(body, pull.headSha),
      (item) => item.id,
      budget,
      isCurrent,
    );
    const statuses = await readPages(
      http,
      `${ref}/status`,
      (body) => parseStatuses(body, pull.headSha),
      (item) => item.name,
      budget,
      isCurrent,
    );
    const reviews = await readPages(
      http,
      `${prefix}/pulls/${pull.number}/reviews`,
      (body) => ({ items: parseReviews(body) }),
      (item) => item.id,
      budget,
      isCurrent,
    );
    if (!isCurrent()) throw new Error('GitHub refresh was cancelled.');
    pull.signals = {
      headSha: pull.headSha,
      attemptedAt,
      checks: checkObservation(runs, statuses, pull.signals?.checks),
      reviews: reviewObservation(reviews, pull.signals?.reviews),
    };
  }
  return limitSignalCache(result);
}

/** Keep compact details for the 100 most recently attempted PRs per source.
 * Attempt times survive eviction so older/unread work cannot starve the queue. */
export function limitSignalCache(pulls: CachedPull[]): CachedPull[] {
  const detailed = pulls
    .filter((pull) => pull.signals?.checks || pull.signals?.reviews)
    .sort((a, b) => b.signals!.attemptedAt.localeCompare(a.signals!.attemptedAt));
  const retained = new Set(detailed.slice(0, 100).map((pull) => pull.number));
  return pulls.map((pull) =>
    pull.signals && !retained.has(pull.number)
      ? {
          ...pull,
          signals: { headSha: pull.signals.headSha, attemptedAt: pull.signals.attemptedAt },
        }
      : pull,
  );
}
