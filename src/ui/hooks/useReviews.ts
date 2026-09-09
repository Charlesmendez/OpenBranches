import { useEffect, useMemo, useRef, useState } from 'react';
import type { Repository, ReviewCommand, ReviewResult, ReviewState } from '../../domain/types';
import { recommendationsFor } from '../../domain/branches';
import { groupReviews } from '../../domain/reviews';

const DEMO_KEY = 'ob-demo-reviews-v1';
async function readDemo(): Promise<ReviewState> {
  const { readReviewState } = await import('../../domain/reviewDecisions');
  try {
    return readReviewState(JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null'));
  } catch {
    return readReviewState({ unreadable: true });
  }
}
export function useReviews(demo: boolean, repositories: Repository[]) {
  const [stored, setStored] = useState<{
    demo: boolean;
    state: ReviewState;
    ready: boolean;
    connectionFailed?: boolean;
  }>({ demo, state: { decisions: [] }, ready: false });
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const pending = useRef(false);
  const state = stored.demo === demo ? stored.state : { decisions: [] };
  const ready = stored.demo === demo && stored.ready;
  const connectionFailed = stored.demo === demo && !!stored.connectionFailed;
  useEffect(() => {
    const revision = ++generation.current;
    const valid = () => generation.current === revision;
    pending.current = false;
    setBusy(false);
    setError('');
    setNow(Date.now());
    setStored({ demo, state: { decisions: [] }, ready: false });
    if (demo || !window.openbranches) {
      void readDemo()
        .then((state) => {
          if (valid()) setStored({ demo, state, ready: true });
        })
        .catch(() => {
          if (valid())
            setStored({
              demo,
              state: {
                decisions: [],
                error: 'Demo review choices could not be loaded. Please retry.',
              },
              ready: true,
              connectionFailed: true,
            });
        });
      return () => {
        ++generation.current;
      };
    }
    const api = window.openbranches;
    let eventReceived = false;
    const off = api.onReviews((next) => {
      if (valid()) {
        eventReceived = true;
        setNow(Date.now());
        setStored({ demo, state: next, ready: true });
      }
    });
    void api
      .getReviews()
      .then((next) => {
        if (valid() && !eventReceived) setStored({ demo, state: next, ready: true });
      })
      .catch(() => {
        if (valid() && !eventReceived)
          setStored({
            demo,
            state: {
              decisions: [],
              error:
                'Saved review choices are unavailable. Findings remain visible; retry before changing your choices.',
            },
            ready: true,
            connectionFailed: true,
          });
      });
    return () => {
      ++generation.current;
      off();
    };
  }, [demo, reload]);
  useEffect(() => {
    const next = Math.min(
      ...state.decisions.flatMap((decision) =>
        decision.until && decision.until > now ? [decision.until] : [],
      ),
      now + 30_000,
    );
    const timer = setTimeout(() => setNow(Date.now()), Math.max(20, next - Date.now()));
    const focus = () => setNow(Date.now());
    window.addEventListener('focus', focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
    };
  }, [state.decisions, now]);
  const recommendations = useMemo(
    () => repositories.flatMap((repository) => recommendationsFor(repository, now)),
    [repositories, now],
  );
  const groups = useMemo(
    () => groupReviews(recommendations, state.decisions, now),
    [recommendations, state.decisions, now],
  );
  const perform = async (run: () => Promise<ReviewResult>) => {
    if (pending.current || !ready || connectionFailed) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    const revision = generation.current;
    try {
      const result = await run();
      if (generation.current === revision) {
        setNow(Date.now());
        setStored({ demo, state: result.state, ready: true });
        setError(result.error ?? '');
      }
      return result.ok;
    } catch {
      if (generation.current === revision)
        setError('Your review choice could not be saved. Please try again.');
      return false;
    } finally {
      if (generation.current === revision) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const saveDemo = (next: ReviewState): ReviewResult => {
    localStorage.setItem(DEMO_KEY, JSON.stringify({ version: 1, decisions: next.decisions }));
    return { ok: true, state: next };
  };
  const decide = (command: ReviewCommand) =>
    perform(async () => {
      if (!demo && window.openbranches) return window.openbranches.decideReview(command);
      const { applyReviewCommand } = await import('../../domain/reviewDecisions');
      return saveDemo(applyReviewCommand(state, command, recommendations));
    });
  const reset = (repositoryId?: string) =>
    perform(async () =>
      demo || !window.openbranches
        ? saveDemo({
            decisions: repositoryId
              ? state.decisions.filter((decision) => decision.repositoryId !== repositoryId)
              : [],
          })
        : window.openbranches.resetReviews(repositoryId),
    );
  const decideMany = (commands: ReviewCommand[]) =>
    perform(async () => {
      const revision = generation.current;
      let next = state;
      if (demo || !window.openbranches) {
        const { applyReviewCommand } = await import('../../domain/reviewDecisions');
        for (const command of commands) next = applyReviewCommand(next, command, recommendations);
        return saveDemo(next);
      }
      for (const command of commands) {
        if (generation.current !== revision) return { ok: false, state: next };
        const result = await window.openbranches.decideReview(command);
        if (!result.ok) return result;
        next = result.state;
      }
      return { ok: true, state: next };
    });
  return {
    groups,
    state,
    ready,
    busy,
    error,
    now,
    decide,
    decideMany,
    reset,
    connectionFailed,
    retry: () => setReload((value) => value + 1),
  };
}
export type ReviewsController = ReturnType<typeof useReviews>;
