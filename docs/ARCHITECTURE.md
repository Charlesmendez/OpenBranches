# Architecture

The renderer has no Node.js access. It talks through a narrow typed preload bridge to the Electron main process. Repository changes are observed, not performed.

- `src/domain`: shared branch types, lifecycle classification, evidence labels, deterministic recommendations, semantic evidence revisions, and validated review choices.
- `src/ui`: React views, reusable components, and workspace/provider hooks. React Flow renders bounded groups; the inventory virtualizes rows.
- `src/data/demo.ts`: fictional example projects. Real and demo workspaces are separate.
- `electron/git`: Git installation discovery and explicit Apple setup, read-only Git commands, NUL-delimited parsing, bounded worktree inspection, and a worker client with terminal errors/timeouts. Discovery supplies an absolute executable; inspection clears inherited Git repository/config overrides.
- `electron/services`: SQLite persistence, repository watching/reconciliation, review decisions, and coordinated project monitoring. A Git failure retains the previous snapshot with an availability error.
- `electron/github`: fixed-origin HTTP transport, GitHub App device authorization, encrypted credential vault, paginated metadata reading, bounded immutable-SHA comparisons, source enrichment, and refresh scheduling.
- `electron/codex`: executable/version detection, a stdio inspection client with a read-method allowlist, bounded task-index parsing, pure association rules, and a cancellable refresh/cache service.
- `electron/advisor`: shared policy, persistent global allowance, bounded metadata preparation, evidence identifiers, and structured finding validation. Model execution and scheduling are not yet wired; see `docs/ADVISOR.md` for the execution gate.
- `scripts`: reproducible builds, generated icons, and native macOS disk images. Local builds and release uploads use separate commands.
- `vendor/extract-zip`: five-line CommonJS bridge to the maintained `@electron-internal/extract-zip` package, for older Forge consumers. No custom extraction implementation is maintained here.
- `tests`: temporary Git fixtures and provider protocol/evidence tests.

## Evidence model

A repository identity comes from its canonical common Git directory, so linked worktrees share an identity. Branch entries retain full local and remote ref names. Local and tracked remote commits can differ; their ancestry is evaluated separately. A matching branch name alone does not prove a task association or a merge.

Local target history is checked against immutable commit IDs from the scan. Missing/shallow history remains unknown. A non-ancestor commit is described as absent from the checked history; squash/rebase equivalence requires more evidence. GitHub PR history is separate evidence and must never silently override newer branch work.

GitHub enrichment does not fetch into a repository. Exact local or cached ancestry is reused only for matching branch/target SHAs; bounded REST comparisons cover commits absent locally. The inspector separates local from published target history. New remote tips without evidence remain unknown. Source failures retain the prior checked time. Partial listings never prove deletion. Cached remote refs are retained and labelled if GitHub no longer lists them. See [GitHub history](GITHUB_HISTORY.md) for batching, source semantics, and verification.

Review choices belong to a finding ID and a SHA-256 revision of its branch evidence. Observation timestamps and unrelated target-tip advances are excluded so normal refreshes do not undo choices. Native commands recheck the current finding before writing SQLite; the renderer cannot choose its own expiry time. The demo has an independent store and stable fictional evidence. See [review behavior](REVIEWS.md).

Stopping monitoring prepares the next repository snapshot and GitHub, Codex, and valid review caches in one SQLite transaction. Services adopt the new memory state and stop watchers only after commit. A failed cache write rolls back every record. Local scans and provider refreshes from the previous monitoring session cannot replace data after removal/re-addition.

## Process boundaries

Production content uses a restricted custom protocol, CSP, sandboxed renderer, context isolation, validated IPC senders, denied popups/permissions, and allowlisted external links. Git commands use argument arrays, have timeouts, disable fsmonitor and configured file-filter commands, and do not take optional index locks. SQLite stores snapshots; GitHub credentials use Electron safeStorage with a macOS Keychain-protected key, so the database stores ciphertext only.

Codex discovery uses a separate app-server process with no thread creation or model execution. Its request allowlist is independent of renderer IPC, and server-initiated requests are refused. Disconnect invalidates in-flight results before closing the process and clearing cached data. Metadata overlays never alter the underlying Git snapshot. Branch names index candidate tasks so a large history does not require matching every task against every branch.

The future AI advisor must obey the full privacy, budget, and read-only contract in the roadmap before becoming user-accessible. Discovery's method restrictions do not establish the safety of model execution; that needs its own verified boundary.
