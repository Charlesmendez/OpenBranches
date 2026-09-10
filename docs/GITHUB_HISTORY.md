# GitHub history evidence

The branch inspector separates **This Mac** from **GitHub**. A local `develop` and a published `origin/develop` can point to different commits. Each view names the branch commit and the target commits it describes. GitHub-only entries open directly to published history. Unavailable sources show the saved snapshot time; unfinished comparisons remain unknown.

## What the reader proves

`src/github/history.ts` compares immutable target and branch SHAs through GitHub's read-only comparison endpoint. With the target as BASE and branch as HEAD, `behind` or `identical` proves that the branch commit is in the target's history; `ahead` or `diverged` means that exact commit is absent. The reader checks direction, counts, target identity, and merge-base consistency. A truncated or empty page of commits never proves absence. Squash and rebase equivalence remain separate PR evidence.

Requests use `per_page=1&page=2`, which omits the first page's changed-file patches. Only SHA pairs, states, provenance, check times, and retry times enter the cache. Commit messages, patches, file contents, and comparison response bodies are discarded. The app performs no Git fetch or repository mutation.

Exact local ancestry can satisfy a published comparison when **both** SHAs match. Negative results from shallow local history are excluded. Successful comparisons are reusable for the same immutable pair; either tip changing requires a different result. Ref names alone never transfer history. Cached evidence is scoped to its repository and remote, and obsolete pairs are pruned.

## Resource bounds and freshness

- Up to 12 new comparison requests share a 30-second comparison-time allowance per workspace refresh. A request already in progress may finish within the HTTP layer's 15-second timeout. Metadata pagination time does not consume that allowance.
- Sources rotate between refreshes so one large repository or remote does not monopolize the allowance. Identical SHAs and repeated branch aliases require no duplicate comparison request within a source.
- Previously unchecked pairs precede failed retries. Unavailable pairs stay unknown and normally retry after ten minutes. GitHub authentication, rate-limit, and service errors stop the current comparison batch; the HTTP transport enforces provider backoff.
- Up to 5,000 listed branches and four standard integration target names produce at most 20,000 cached pairs per remote. The workspace displays completed versus observed comparisons. Cold repositories with many commits absent locally can need several refreshes; public, unauthenticated GitHub access can take longer under provider limits. This is periodic observation, not a live server stream.
- Snapshot freshness starts before pagination. A slow refresh cannot make earlier branch observations appear newly checked. Disconnect and monitoring changes stop subsequent requests and prevent late results from being adopted.

## Older pull requests by exact commit

Open and recently updated closed pull requests still come from separate bounded listings. When a non-integration branch tip has no PR in those listings, the reader now checks GitHub's pull requests associated with that exact commit SHA. It accepts a result for branch attachment only when the returned PR head SHA still equals the queried tip. A PR whose head later moved cannot attach to the older branch copy by name.

Desktop refreshes share six exact-commit requests and 15 seconds across the workspace, visiting unchecked tips before cached ones. The team reader applies the same six-request bound to a selected repository refresh. Unusual responses with more than 100 associations resume at the next page on a later refresh. Empty exact-tip results retry after ten minutes so a newly opened PR can appear; found results refresh hourly so state changes are not frozen. Saved lookup coverage is pruned when the branch tip disappears or changes.

The existing 5,300-record PR cache bound still applies. Open PRs remain first, followed by exact-tip results and then recent unrelated closed history, so targeted evidence is not silently discarded when a large repository fills the cache. The branch inspector shows whether its exact-tip lookup is still running, completed without a match, failed, or returned evidence that was rejected because the branch identity no longer matched.

This closes the common gap where an older merged or closed PR fell outside the three-page recent-closed listing. It does not claim complete repository-wide PR history. “No PR” means none was present in the bounded listings or returned for that exact branch tip at its last completed lookup.

The map and inventory keep their repository target identities. Existing local targets are preserved; origin (or a sole configured GitHub source) can supply missing target names. The inspector's GitHub view separately shows the published targets even when same-named local targets differ. Broader cross-source overview refinement remains on the roadmap.

## Reviews and AI

Published states participate in semantic review revisions. Changed evidence resurfaces a dismissed or snoozed finding; observation time and target advances that leave the state unchanged do not. Advisor packets include published history as separately cited evidence. Cleanup candidates must account for it and are rejected when it is unknown, pending, or unavailable. The AI runner remains disabled pending the execution gate described in [ADVISOR.md](ADVISOR.md).

## Verification

`tests/github-history.test.ts` covers comparison directions, empty/truncated pages, invalid evidence, exact-pair caching, changed tips, local/shallow evidence, a 1,000-branch batch, retries, limits, cancellation, elapsed/request bounds, source separation, new targets, review revisions, and cleanup preservation. The fictional browser fixture at `/tests/ui/history.html` covers keyboard source switching, different commits, remote-only branches, pending comparisons, unavailable GitHub, and a newly discovered target. Browser checks found and fixed duplicate sibling keys in the inspector; the production build excludes fixture entry points.

The implemented reader was also checked against the public OpenBranches repository: it listed three branches, reused identical integration tips, and correctly classified the feature commit as absent from the integration target. Native service refresh and the new inspector still need a combined packaged-app check. PR metadata now survives remote-branch deletion independently of branch rows, open work has its own bounded listing, and exact-tip lookup recovers older closed or merged PRs without attaching them to newer local commits. See [collaboration evidence](COLLABORATION.md).

References: [GitHub REST comparison endpoint](https://docs.github.com/en/rest/commits/commits#compare-two-commits) and [pull requests associated with a commit](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit).
