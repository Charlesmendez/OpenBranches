# Coding tools, models, and live work

OpenBranches scans Git branches independently of the tool that created them. Tool badges add evidence; they do not decide which branches appear. A person, a coding tool, and a model are separate identities. Saved sessions do not establish authorship, exclusive ownership, or current activity.

## Implemented sources

| Source          | Current support                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex           | Separate opt-ins for bounded app-server task history and live lifecycle hooks, plus shared-daemon runtime state when available. Current and archived task associations remain available. |
| Claude Code     | Separate opt-ins for bounded saved-session metadata and live lifecycle hooks. The hook supplies current state; history keeps structural metadata and explicit custom titles.             |
| Cursor and Grok | Opt-in Cursor lifecycle hooks supply current state and the explicitly reported model ID. Grok remains a model paired with Cursor; OpenBranches never relabels Cursor itself as Grok.     |
| Unknown tools   | Explicit text and icon fallback. Branch prefixes, instruction files, configured models, recent commits, dirty worktrees, and commit-author names never supply live attribution.          |

A branch may have several sessions from several tools. Provider-scoped session keys prevent equal IDs from colliding, and one provider's overlay preserves the others. A verified saved association requires a known repository/worktree folder, the recorded branch, and an exact current local or remote commit. A folder and branch match without a saved commit remains possible. Claude history does not supply a commit, so history-only associations remain possible. Detached worktrees require folder and commit evidence.

Live activity uses a stricter current-checkout rule. The event folder must equal a monitored repository or worktree, the repository scan must be fresh, the worktree must be available and attached to a named branch, and its current head must equal that branch's local tip. A fresh event without the full match is not attached to any branch. The map glow expires 90 seconds after the last event. The local inspector retains the matched worktree path long enough to mark the exact checkout as working or waiting. Team snapshot preparation deliberately omits that path and shares only the already-approved aggregate branch status. Session-open, stop, and response-complete events are idle; explicit Claude permission and input events are waiting. Cursor multi-root events without one exact working folder are rejected instead of lighting several branches.

Badges appear on the branch map, inventory, and inspector. Recorded model IDs are visible in session details and searchable with tool names and task titles. The Cursor adapter normalizes an explicitly reported Grok model ID to xAI before the Grok icon appears; it stays paired with Cursor. Historical model IDs without provider evidence do not receive that icon. Only Codex sessions expose the association-checked **Open in Codex** action.

## Claude history source and privacy

The history reader supports local main-session UUID JSONL files below `~/.claude/projects/<encoded-project-path>/`, or an absolute inherited `CLAUDE_CONFIG_DIR`. This is a local-format integration, not a guaranteed cross-version API. Claude Desktop, Cowork, remote sessions, subagents, and arbitrary custom stores are not claimed as supported.

Reading JSONL brings bounded transcript bytes into memory. A strict parser immediately discards message bodies, first prompts, tool input/output, usage data, queues, and other fields. Only session ID, tool, selected folder, recorded branch, timestamp, explicit custom title, and a reported model ID enter the normalized result. Prompt text is never used as a title. The reader leaves model provider unspecified because a model ID alone does not prove its provider. Nothing is uploaded.

The connection starts disabled. It reads only history folders corresponding to monitored repositories and worktrees, including canonical path aliases. Recorded working directories must still match selected folders because encoded directory names can collide. Regular UUID-named files are opened read-only without following file symlinks. Resolved project folders must stay inside the selected Claude profile. Sidechain and foreign-session records cannot supply evidence.

## Live hooks and privacy

Live activity starts disabled independently for Codex, Claude Code, and Cursor. Enabling a tool in Settings adds one OpenBranches-owned command handler to that tool's user hook file and writes a small reporter script beside it. Codex uses `~/.codex/hooks.json`, Claude uses `~/.claude/settings.json`, and Cursor uses `~/.cursor/hooks.json`. Existing settings and unrelated hooks are preserved. Repeated setup is idempotent, files are replaced atomically, symbolic-link targets are refused, and disconnect removes only the exact OpenBranches handlers and owned script. The app repairs an already approved hook when its private endpoint changes between launches. Codex independently requires the user to review and trust a new or changed hook before it runs; OpenBranches cannot approve that trust decision.

The reporter forwards the tool's JSON event to a random loopback port while OpenBranches is open. The listener binds only to `127.0.0.1`, requires a 256-bit bearer token, accepts JSON POSTs on a provider-specific path, limits bodies to 32 KiB and requests to 600 per minute, and does not enable browser CORS. The command stops after one second when the app is unavailable and always returns control to the coding tool.

A provider-specific parser immediately drops prompts, responses, commands, tool input/output, transcript paths, file names, account email, model parameters, and unknown fields. Only provider session ID, tool, one absolute workspace folder, lifecycle state, an explicitly reported model ID, and OpenBranches' receipt time enter memory. Events are not persisted. Stopped sessions are retained in memory for at most five minutes; live state expires after 90 seconds. Team sharing can include normalized status only through the existing explicit per-project device consent flow.

The integration follows the official [Codex hook lifecycle and trust model](https://learn.chatgpt.com/docs/hooks), [Claude Code hook lifecycle and configuration](https://code.claude.com/docs/en/hooks), and [Cursor hook schema](https://prod.cursor.com/docs/hooks). User-level hooks report only local sessions, so OpenBranches does not claim live coverage for remote environments.

## Bounds and lifecycle

Claude history refreshes every minute and on explicit workspace refresh. Each source read has a 25-second service deadline. The reader stops starting work after 20 seconds, considers at most 5,000 path aliases and 5,000 directory entries per folder, and reserves at most 64 MiB per pass. Every attempted file reserves 256 KiB, so at most 256 files fit within that byte budget. At most 256 KiB is read from each file: smaller files in full, larger files from the first and last 128 KiB. A truncated read needs relevant context in its final chunk.

Recent files are considered first. Project order rotates between passes so a busy folder does not indefinitely starve others. Partial results cannot prove that an older session disappeared. Previously retained sessions keep their own observation time until seen again. The cache retains at most 1,000 sessions that still associate with monitored branches.

Disconnect cancels history work, clears that provider's cache, and rejects late results. Removing a monitored project prunes local-history metadata in the same SQLite transaction as repository, GitHub, Codex, discovery, and review state. Failures retain prior evidence with its prior checked time and a readable error.

## Verification and remaining work

Automated tests cover mixed tools and confidence, explicit model evidence, unknown tools, transcript-field exclusion, hook payload stripping, lifecycle state mapping, exact checkout/head matching, event expiry, authentication, body bounds, multi-root rejection, settings preservation, idempotent install, owned removal, startup repair, malformed settings, symlink refusal, branch changes, selected-folder boundaries, rotating budgets, timeouts, cache persistence, disconnect/removal races, and transaction rollback.

Live hook tests use isolated temporary homes and random loopback ports; they never modify the developer's real Codex, Claude, or Cursor settings. The fictional team workspace includes live Codex, Claude Code, and Cursor activity plus a Cursor-reported Grok model for visual checks.

Bundled SVGs are from MIT-licensed LobeHub Icons 1.95.0; [source and license](../assets/providers/README.md) accompany the assets. No repository or session can choose an arbitrary icon URL.

Other coding-tool adapters, remote/cloud runtime coverage, broader source-version checks, and real multi-device acceptance remain unfinished. See [team acceptance](TEAM_WORKSPACES.md) and the [release roadmap](ROADMAP.md).
