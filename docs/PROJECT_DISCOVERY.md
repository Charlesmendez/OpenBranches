# Automatic project discovery

OpenBranches reads saved local Codex project folders and offers **Follow Codex projects** in Settings. The empty workspace links directly to this setup. Following is off until selected, requires no model execution, and checks for new saved folders every minute. The sidebar always exposes project search and Manage projects; Settings also searches monitored and discovered folders. Removal uses Stop monitoring and leaves Git files and worktrees intact.

## Source and limits

The adapter reads only the `electron-saved-workspace-roots`, `electron-workspace-root-labels`, and `local-projects` fields of `.codex-global-state.json` beneath an absolute `CODEX_HOME` or the default home directory. Both formats were observed on the development Mac. This is an internal desktop format rather than a documented public API and must be tested against future versions. Unsupported/unreadable data results in an explanation; existing monitored projects are retained. It does not read thread bodies or prompts into the discovery result, scan unrelated disk locations, or write Codex state.

Only absolute saved paths are considered. Directory aliases are resolved and deduplicated; missing folders remain visible. A saved folder is not assumed to be a Git repository. Following sends candidates through the existing read-only Git scanner. The registry read is capped at 16 MiB, and project roots at 5,000. Imports rotate through up to 24 candidate scans per pass with a 30-second start budget; an already-running Git scan keeps its normal worker timeout. Remaining folders are counted and continue in subsequent passes.

A separate saved Codex root in an already monitored worktree family does not replace the user's existing primary project folder. Turning following off prevents late imports and stops future automatic additions, while already monitored projects remain. New additions are subsequently enriched by the existing provider refreshes.

## Removal

The project's repository identity is added to persistent discovery exclusions in the same SQLite transaction as monitoring removal and connection-cache cleanup. After commit, late imports recheck the exclusion immediately before adoption. Exclusions survive restarts and are checked even when Codex discovers another worktree for that repository. Removed folders are not re-added unless the user explicitly permits removed projects again or manually adds them. Corrupt exclusion data pauses automatic following until the user resets the choices, rather than silently losing removal preferences.

## Verification

`tests/discovery.test.ts` covers both source formats, privacy-field omission, real directory aliases, missing/invalid state, search normalization, opt-in discovery, primary-root preservation, removed-project races and restart, transaction rollback, disabled-following races, unavailable/non-Git sources, rotating import batches, oversized registries, and recovery from invalid or unreadable removal preferences.

The browser fixture at `tests/ui/setup.html?discovery` uses twelve fictional folders and simulated desktop operations. UI checks verified entry from the empty workspace, folder review, normalized search, import, sidebar and monitored-project filtering, removal, refresh exclusions, restoration, and clearing obsolete removal notices. A 1280×720 visual check verified compact sidebar spacing. The production renderer and desktop bundle detected 31 saved folders on the development Mac, and native search found a saved folder. Following remained off in that check; real bulk import was not performed.

Broader real multi-project import, future Codex format compatibility, and complete team discovery remain release work. No Claude or Grok discovery support is implied by this adapter.
