# Maps, activity, and attention

The map compares the displayed branch copy independently with every integration target. Local Git uses the scanner's local tip (or cached remote tip when no local copy exists). The GitHub view uses the published remote tip and its exact target SHAs. The target cards identify local, cached, or GitHub history.

A solid line means the displayed commit is included in the target's history. A dashed line means a fresh open PR from that exact tip targets that exact GitHub repository and branch. A PR never establishes inclusion and never points into a same-named local target. Missing evidence produces no line. Cached inclusion is labeled as cached. Absence from commit history cannot disprove equivalent squash-merged, rebased, or cherry-picked changes.

Group connections appear only when every branch in the group has the same verified relationship. Expanded cards show independent target badges, so work in develop but not main is immediately distinguishable. Card edges route through gutters rather than behind other branch cards.

The controlled graph keeps explicit measured card dimensions across snapshots. Fitting uses current node bounds directly; a saved viewport with no visible cards is recovered after layout and resize. User pan/zoom remains separate from programmatic fitting. The development fixture at `/tests/ui/map-refresh.html` exercises offscreen saved positions, repeated snapshots, pagination, and remounts. The browser check retained eight visible nodes through 85 snapshot refreshes and leaving/returning to the map.

## Activity coverage

When available, the Codex adapter attaches read-only to the existing local app-server daemon through `app-server proxy`. It does not start a daemon. Every 15 seconds it reads at most 100 loaded task metadata records, without turns, using bounded concurrency and deadlines. Missing pages or failures are reported as partial coverage. Runtime status is held only in memory and stripped from the persisted task index.

Running or waiting labels require a fresh runtime observation and a fresh Git checkout whose folder, branch, and HEAD match. A saved task's old branch cannot inherit live status after a checkout switch. Runtime evidence expires after 90 seconds; incomplete or unavailable coverage never means nobody is working. The development Mac's current Codex desktop session did not expose the managed daemon socket, so real live-status verification remains unavailable there.

Each project toolbar makes live coverage visible without adding another dashboard. On the map, active work appears once in the prominent **Happening now** rail. In the branch inventory, the toolbar shows the live/waiting count and focuses the highest-priority branch in one click. When no live work is present, the same compact control says which tools are being watched or links directly to live activity setup when coverage is off.

Claude Code and Cursor can supply fresh activity through their separate opt-in local hooks. Other saved tool/model metadata is not live presence. PR authors and commit authors are labeled by source and do not establish who is working now. Recent task updates and uncommitted work are distinct activity labels. Human presence and unpublished teammate activity still require an opted-in companion with its own observed evidence.

An idle marker requires seven days without a commit or verified task update, pending integration, no open PR or confirmed running/waiting task, and no dirty or unreadable worktree. “Unassigned” means no linked task or open PR was observed; it does not prove abandonment.

## Attention queues

Rules are deduplicated to one row per branch after applying saved review choices. The three queues cover unpublished work, idle work, and integration gaps. The sidebar counts nonempty queues rather than presenting every old branch as an urgent alert. The default starting list contains at most five branches, spread across projects when unscoped. All matching branches remain searchable, paginated, and reviewable.

Selecting visible rows supports a single bulk handoff as well as bulk snooze, dismiss, and restore. **Send all selected to…** includes every selected branch. Branches from one repository share one agent task; selections across repositories are split into one task per repository because each agent needs a concrete workspace. The user reviews the exact provider, branch groups, prompt, and evidence before launch.

Handoffs use Codex, Claude, or Cursor already installed and signed in on the Mac. The first task is constrained to read-only investigation and asks for a concrete proposal. It cannot edit, push, merge, close PRs, or delete branches. Queued and running handoffs appear as verified task activity on every included branch, so the map and review row show which agent is investigating it. Proposals and failures remain visible in the attention screen. See [agent handoffs](HANDOFFS.md).

Snooze, dismiss, and restore only change review choices; they never alter Git. Evidence is expandable within each row. Snoozing lasts seven days, and dismissal remains until the evidence revision changes. The connected Codex label reflects actual provider state and linked task count. Deterministic Git findings are not described as AI reviews.

Verification includes a 500-branch/1,000-rule fixture, per-target and cross-fork PR checks, divergent local/remote tips, stale and missing history, runtime expiry, branch switches, waiting tasks, partial live coverage, and saved-choice behavior. Native verification confirmed that the previously blank hibe-backend map rendered and its attention screen showed the connected task count and three queues.
