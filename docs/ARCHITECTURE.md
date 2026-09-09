# Architecture

The renderer has no Node.js access. It talks through a narrow typed preload bridge to the Electron main process. Repository changes are observed, not performed.

- `src/domain`: shared branch types, lifecycle classification, evidence labels, and deterministic recommendations.
- `src/ui`: React views, reusable components, and workspace/provider hooks. React Flow renders bounded groups; the inventory virtualizes rows.
- `src/data/demo.ts`: fictional example projects. Real and demo workspaces are separate.
- `electron/git`: read-only Git commands, NUL-delimited parsing, bounded worktree inspection, and a worker client with terminal errors/timeouts.
- `electron/services`: SQLite persistence and repository watching/reconciliation. A Git failure retains the previous snapshot with an availability error.
- `electron/github`: fixed-origin HTTP transport, GitHub App device authorization, encrypted credential vault, paginated metadata reading, source enrichment, and refresh scheduling.
- `scripts`: reproducible builds, generated icons, and native macOS disk images. Local builds and release uploads use separate commands.
- `vendor/extract-zip`: five-line CommonJS bridge to the maintained `@electron-internal/extract-zip` package, for older Forge consumers. No custom extraction implementation is maintained here.
- `tests`: temporary Git fixtures and provider protocol/evidence tests.

## Evidence model

A repository identity comes from its canonical common Git directory, so linked worktrees share an identity. Branch entries retain full local and remote ref names. Local and tracked remote commits can differ; their ancestry is evaluated separately. A matching branch name alone does not prove a task association or a merge.

Local target history is checked against immutable commit IDs from the scan. Missing/shallow history remains unknown. A non-ancestor commit is described as absent from the checked history; squash/rebase equivalence requires more evidence. GitHub PR history is separate evidence and must never silently override newer branch work.

GitHub enrichment does not fetch into a repository. New remote tips without available ancestry remain unknown. Source failures retain the prior checked time. Partial listings never prove deletion. Cached remote refs are retained and labelled if GitHub no longer lists them.

## Process boundaries

Production content uses a restricted custom protocol, CSP, sandboxed renderer, context isolation, validated IPC senders, denied popups/permissions, and allowlisted external links. Git commands use argument arrays, have timeouts, disable fsmonitor and configured file-filter commands, and do not take optional index locks. SQLite stores snapshots; GitHub credentials use Electron safeStorage with a macOS Keychain-protected key, so the database stores ciphertext only.

The future Codex adapter and advisor belong in separate provider/service modules. They must obey the full privacy, budget, and read-only contract in the roadmap before becoming user-accessible.
