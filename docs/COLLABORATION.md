# People and pull requests

The Mac app now includes **People & PRs**, using GitHub metadata from connected repositories. It groups work by PR author and requested reviewer, with a separate bot label and an unavailable-author fallback. Requested teams remain teams; their membership is not inferred. The view does not imply company membership, branch ownership, live activity, or productivity.

Search covers people, repository/project names, PR numbers and titles, branch names, requested teams, and recorded tool/model evidence. Project and tool filters combine with a person selection. Open PRs, requested reviews, quiet drafts, and recent history have separate views. Quiet drafts are open drafts with no recorded PR update for at least 14 days; this suggests a check-in, not abandonment. People pages contain at most eight entries; PR pages contain at most twelve cards. Branch inspection preserves the selected person, filters, and page, including across restarts. Real and demo navigation preferences remain separate.

PR cards show their author, requested reviewers, branch/base, state, observation time, and related coding-tool evidence. Inspect branch is available only for a recorded association. PRs without a matching local branch still appear and can be opened on GitHub. The branch inspector also shows explicit PR authorship and review requests. Expandable check results, submitted reviews, and the Checks need attention filter are implemented with separate observation times and exact-commit evidence; see [PR signal behavior and limits](PR_SIGNALS.md). Demo actions remain fictional.

## GitHub source

The read-only [pull requests endpoint](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests) supplies PR authors, requested reviewers, and requested teams. Open work is listed separately from closed history, so recent closed PRs do not push old open drafts out of the same pagination window. The source starts with open PRs, up to 50 pages of 100, followed by up to three pages of recent closed PRs. It stops starting new PR requests after 30 seconds; a request in progress has the existing HTTP layer's 15-second timeout. The source reports incomplete coverage. These are periodic observations rather than a streamed GitHub feed.

PR identity uses the GitHub repository and PR number. Actor identity uses GitHub's stable numeric user ID, serialized as text. Only IDs, login names, account types, requested-team names/slugs, and the existing PR fields are retained. PR bodies, email addresses, profile URLs, avatars, and arbitrary response links are discarded. PR links are constructed from the fixed GitHub origin. The view renders bundled icons and generated initials, with no external avatar requests. The existing Pull requests read permission is sufficient for these fields; no write or organization-membership access is added.

A PR's head repository can be missing after deletion; its metadata is retained independently of Git refs. Branch association now runs after branch enrichment and does not require the remote branch to remain listed. Repository identity, branch name, and matching current commit evidence are required. Closed/merged PRs are not attached to a changed local commit. Deleted forks are not assigned to a branch by name alone.

A partial listing does not erase older cached PRs within the 5,300-record source cache bound. Retained records keep their original observation time and are labeled as last recorded state. A newly observed record replaces the cached one. Complete open coverage can remove an old open record that is no longer listed; this does not establish its new state. Targeted lookup of older closed PRs remains unfinished.

Duplicate remotes and local clones do not multiply PR counts. Branch links are preserved and the latest observed PR state wins; on equal observation times, directly observed evidence takes precedence over retained data, then a successful source over an unavailable one. Source failures, retained records, and observations older than ten minutes are visibly stale. Projects without GitHub data and incomplete open coverage are shown explicitly. Recent history always states that older records may be missing. Connection caches continue to participate in coordinated monitoring removal and disconnect handling.

## Structure and verification

- `src/github/pulls.ts` owns normalization, open/closed pagination, and partial-cache retention. It reuses the fixed-origin HTTP transport and existing service lifecycle.
- `src/domain/collaboration.ts` indexes and deduplicates PR evidence, keeps person roles distinct, and supplies shared search/filter selectors. Branch links are indexed once per repository.
- `People`, `PeoplePullCard`, and `PullPeople` separate workspace layout, PR presentation, and reusable identity display. Scoped styles accompany the collaboration view.
- `peopleNavigation.ts` and `usePeoplePosition` reuse the existing bounded, coalesced navigation store; they do not create another persistence backend.

Automated cases cover metadata exclusion, missing heads/authors, bots and requested teams, open-versus-history pagination, caps and elapsed time, cancellation, legacy caches, partial retention, exact deleted-branch associations, changed commits, clone deduplication, person/tool/project/model filters, stale timestamps, a 1,000-PR dataset, and navigation preservation.

A read-only live check against the public OpenBranches repository returned one open draft, the known repository owner's author identity, requested-review arrays, and complete open/history coverage. The normalized result contained no PR body or private profile fields. The browser demo exercises 45 fictional PRs across three projects and 12 fictional accounts. Checks verified combined person/model/project filtering, branch inspection, return navigation, page reload, and quiet-draft results at a 1280 × 820 Mac window size.

The full suite passed **164 tests across 17 files**, with successful type checking, production build, formatting, and diff checks. The people view is loaded on demand; the initial renderer bundle remains below the existing 500 kB build warning threshold. The built Mac app loaded that module through its production protocol, displayed the real OpenBranches draft and author, and correctly identified the other monitored project as lacking GitHub data. Original monitored projects and provider opt-in choices were preserved.

## Remaining team scope

This feature does not connect members' devices or upload local work. The authenticated company workspace, member/project permissions, device pairing, sharing preview, opt-in unpublished work, revocation/unsharing, and real two-member/device verification remain required. Company membership and PR authorship are separate data sources.

Company alerts integrated with snooze/dismiss, additional coding-tool ingestion, targeted historical PR lookup, broader performance/accessibility/native tests, and self-hosted service installation also remain. Review-request counts and recorded check/review results do not claim current approval status or merge readiness. See [the team contract](TEAM_WORKSPACES.md) and [full release scope](ROADMAP.md).
