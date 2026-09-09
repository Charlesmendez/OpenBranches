# Coding tools and saved sessions

OpenBranches scans Git branches independently of the tool that created them. Tool badges are an additional layer of evidence, not a filter on which branches appear. A person, a coding tool, and a model are separate identities. Saved sessions do not establish authorship, exclusive ownership, or current activity.

## Implemented sources

| Source          | Current support                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex           | Existing opt-in local app-server metadata reader, now tagged explicitly as Codex. Current and archived task associations remain available.                              |
| Claude Code     | New opt-in local session-file reader for monitored repository/worktree folders. Keeps structural metadata and explicit custom titles; does not start Claude or a model. |
| Cursor and Grok | Shared types, icons, search, and fictional examples demonstrate a coding tool using a recorded model. Live ingestion is not implemented yet.                            |
| Unknown tools   | Explicit text and icon fallback. A branch prefix, instruction file, configured model, or commit-author name never supplies attribution.                                 |

A branch may have several sessions from several tools. Provider-scoped session keys prevent equal IDs from colliding. Replacing one provider's overlay preserves the others. A verified association requires a known local repository/worktree folder, the recorded branch, and an exact current local or remote commit. A folder and branch match without a saved commit is a possible association. Claude's current metadata source does not supply a commit, so its associations remain possible. Detached worktrees require folder and commit evidence.

Badges appear on the branch map, inventory, and inspector. Their accessible descriptions count confirmed and possible matches separately, including when the same tool has both. Recorded model IDs are visible in session details and searchable alongside tool names and task titles. The Grok icon requires both an explicitly reported xAI provider and a Grok model ID; it is paired with the coding tool. Only Codex sessions expose the existing association-checked Open in Codex action.

## Claude source and privacy

Anthropic documents [local session storage](https://code.claude.com/docs/en/sessions) and the [Claude directory layout](https://code.claude.com/docs/en/claude-directory). The reader supports local main-session UUID JSONL files below `~/.claude/projects/<encoded-project-path>/`, or an absolute inherited `CLAUDE_CONFIG_DIR`. This is a local-format integration, not a guaranteed cross-version API. Desktop, Cowork, remote sessions, subagents, and arbitrary custom session stores are not claimed as supported.

The installed SDK's [session metadata API](https://code.claude.com/docs/en/agent-sdk/sessions) was examined while checking the format. No Claude SDK dependency, CLI execution, account credentials, or network request is needed by this implementation. Version coverage remains limited to observed local files and tested structural fixtures; more versions and native connection coverage are release work.

Reading JSONL necessarily brings bounded transcript bytes into memory. A strict parser immediately discards message bodies, first prompts, tool input/output, usage data, queues, and other fields. Only session ID, tool, selected folder, recorded branch, timestamp, explicit custom title, and a reported model ID enter the normalized result. When no custom title exists, a branch-based label is generated; prompt text is never used as a title. A model ID alone does not establish its provider. The Claude reader therefore leaves model provider unspecified. Nothing is uploaded.

The connection starts disabled. Enabling it reads only history folders corresponding to monitored repositories and worktrees, including canonical path aliases. Recorded working directories must still match selected folders, because encoded directory names can collide. Regular UUID-named files are opened read-only without following file symlinks; resolved project folders must remain inside the selected Claude profile's projects directory. Sidechain and foreign-session records cannot supply evidence.

## Bounds and lifecycle

Refresh runs every minute and on explicit workspace refresh. Each source read has a 25-second service deadline. The reader stops starting work after 20 seconds, considers at most 5,000 path aliases and 5,000 directory entries per folder, and reserves at most 64 MiB per pass. Every attempted file reserves 256 KiB, including failures, so at most 256 files fit within that byte budget. At most 256 KiB is read from each file: smaller files in full, larger files from the first and last 128 KiB. A truncated read needs relevant context in its final chunk. A recorded branch/folder change clears prior model evidence.

Recent files are considered first. Project order rotates between passes so a busy folder does not indefinitely starve other projects. Older files in a very large single folder can remain outside the window. Partial results are explicitly labeled and cannot prove that an older session disappeared. Previously retained sessions keep their own observation time until seen again. The cache retains at most 1,000 sessions that still associate with monitored branches.

Disconnect cancels work, clears the provider cache, and rejects late results. Removing a monitored project prunes local-history metadata within the same SQLite transaction as repository, GitHub, Codex, discovery, and review state. All in-memory services adopt changes only after that transaction succeeds. Failures retain prior evidence with its prior checked time and a readable error.

## Verification and remaining work

Automated tests cover mixed tools and confidence, equal IDs, legacy Codex review-revision compatibility, explicit model evidence, unknown tools, transcript-field exclusion, branch changes, sidechains, selected-folder boundaries, encoded-path collisions, symlinks, large files, rotating budgets, timeouts, cache persistence, disconnect/removal races, and transaction rollback.

The complete suite passed 151 tests across 16 files, with successful type checking, production build, formatting, and diff checks. The built Mac app reopened with its two monitored projects preserved, showed unknown attribution for branches without a connected history source, and displayed the disconnected Claude option and its privacy details. A real native Claude connection/import remains unverified; this check did not enable it.

A read-only check against an existing local Claude history folder returned two related sessions with two reported model IDs. The normalized result contained only the documented metadata fields; it did not alter source files, app connection preferences, or the application's cache. The reader reported partial coverage. The browser fixture verifies connect/disconnect controls, mixed session cards, the Codex-only task action, and clean console output. The full fictional workspace verifies Grok search and paired tool/model icons at a 1280 × 820 viewport.

Bundled SVGs are from MIT-licensed LobeHub Icons 1.95.0; [source and license](../assets/providers/README.md) accompany the assets. No repository or session can choose an arbitrary icon URL.

Live Cursor/Grok or other adapters, an extensible event protocol, tool filters, broader source-version/native checks, and the separate person identity and opted-in sharing required for team workspaces remain unfinished. See [team acceptance](TEAM_WORKSPACES.md) and the [full release roadmap](ROADMAP.md).
