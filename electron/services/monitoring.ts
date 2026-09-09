import type { RepositoryService } from './repositories';
import type { GitHubService } from '../github/service';
import type { CodexService } from '../codex/service';
import type { ReviewService } from './reviews';
import type { ProjectDiscoveryService } from '../discovery/service';

/** Each prepared cache write joins RepositoryService's SQLite transaction.
 * Memory and watchers change only after every write has committed. */
export function stopMonitoring(
  id: string,
  repositories: Pick<RepositoryService, 'remove'>,
  github: Pick<GitHubService, 'prepareForgetUnselected' | 'enrich'>,
  codex: Pick<CodexService, 'prepareForgetUnselected'>,
  reviews: Pick<ReviewService, 'prepareForgetUnselected'>,
  discovery?: Pick<ProjectDiscoveryService, 'prepareExclude'>,
): void {
  repositories.remove(id, (next) => {
    const adoptGitHub = github.prepareForgetUnselected(next);
    const adoptCodex = codex.prepareForgetUnselected(github.enrich(next));
    const adoptReviews = reviews.prepareForgetUnselected(next);
    const adoptDiscovery = discovery?.prepareExclude(id);
    return () => {
      adoptGitHub();
      adoptCodex();
      adoptReviews();
      adoptDiscovery?.();
    };
  });
}
