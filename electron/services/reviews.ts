import { z } from 'zod';
import type { AppStore } from './store';
import type { ReviewResult, ReviewState, Snapshot } from '../../src/domain/types';
import { recommendationsFor } from '../../src/domain/branches';
import {
  applyReviewCommand,
  readReviewState,
  reviewCommandSchema,
} from '../../src/domain/reviewDecisions';

export class ReviewService {
  private state: ReviewState;
  constructor(
    private store: Pick<AppStore, 'readStrict' | 'write'>,
    private current: () => Snapshot,
    private publish: (state: ReviewState) => void,
  ) {
    try {
      this.state = readReviewState(store.readStrict('reviews.ledger'));
    } catch {
      this.state = readReviewState({ unreadable: true });
    }
    try {
      this.forgetUnselected();
    } catch {
      this.state = {
        decisions: [],
        error:
          'Saved review choices could not be updated. Findings remain visible. Reset review choices to retry.',
      };
    }
  }
  currentState(): ReviewState {
    return this.state;
  }
  decide(input: unknown, now = Date.now()): ReviewResult {
    const parsed = reviewCommandSchema.safeParse(input);
    if (!parsed.success) return this.failure('This review choice could not be understood.');
    try {
      const recommendations = this.current().repositories.flatMap((repository) =>
        recommendationsFor(repository, now),
      );
      const next = applyReviewCommand(this.state, parsed.data, recommendations, now);
      return this.save(next);
    } catch (error) {
      return this.failure(
        error instanceof Error && !(error instanceof z.ZodError)
          ? error.message
          : 'This review choice could not be saved.',
      );
    }
  }
  reset(repositoryId?: unknown): ReviewResult {
    if (
      repositoryId !== undefined &&
      (!z.string().min(1).max(4096).safeParse(repositoryId).success ||
        !this.current().repositories.some((repository) => repository.id === repositoryId))
    )
      return this.failure('The selected project is no longer monitored.');
    if (repositoryId && this.state.error)
      return this.failure('Reset all review choices to replace the unreadable history.');
    return this.save({
      decisions: repositoryId
        ? this.state.decisions.filter((decision) => decision.repositoryId !== repositoryId)
        : [],
    });
  }
  forgetUnselected(): void {
    this.prepareForgetUnselected(this.current())();
  }
  prepareForgetUnselected(snapshot: Snapshot): () => void {
    if (this.state.error) return () => {};
    const selected = new Set(snapshot.repositories.map((repository) => repository.id));
    const decisions = this.state.decisions.filter((decision) =>
      selected.has(decision.repositoryId),
    );
    if (decisions.length === this.state.decisions.length) return () => {};
    this.store.write('reviews.ledger', { version: 1, decisions });
    return () => {
      this.state = { decisions };
      this.publish(this.state);
    };
  }
  private save(next: ReviewState): ReviewResult {
    try {
      this.store.write('reviews.ledger', { version: 1, decisions: next.decisions });
    } catch {
      return this.failure('Your review choice could not be saved. Please try again.');
    }
    this.state = next;
    this.publish(this.state);
    return { ok: true, state: this.state };
  }
  private failure(error: string): ReviewResult {
    return { ok: false, state: this.state, error };
  }
}
