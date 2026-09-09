# Reviewing findings

The Needs attention view separates **To review**, **Snoozed**, and **Dismissed**. The sidebar badge counts only To review. Every finding is reachable through pages of twenty; filters and page controls stay accessible at the top. Findings can be inspected without changing their review status.

These are deterministic findings derived from Git evidence and available task metadata. Known active task work is not called forgotten just because its last commit is old. Model-generated reviews remain unfinished and disabled.

## What a choice means

- **Dismiss** sets aside the current evidence until that evidence changes or the choice is restored/reset.
- **Snooze 7 days** sets it aside for exactly seven days. Changed evidence can return sooner.
- **Show in To review** restores a finding immediately.
- **Reset this project’s review choices** leaves other projects alone. The workspace-wide reset clears all choices.

A branch’s commit, local/remote references, integration results, worktree state, task metadata, or PR state can change its evidence revision. A changed finding returns to To review with an explanation. Refresh timestamps, daily age wording, and an unrelated advance of a target tip do not reset choices. A finding that no longer meets a rule disappears from these views rather than remaining as a stale card.

The native process recomputes the current finding before accepting a choice. A click against superseded evidence is rejected. Snooze expiry is checked on a timer and when the app regains focus; a backward clock does not indefinitely hide work.

## Storage and recovery

Native choices are stored in the local SQLite database. The main process writes before acknowledging success; failed writes keep the previous choices and show an error. Missing or unreadable history leaves findings visible. Unreadable history requires an explicit reset before new choices can be saved.

The fictional demo uses separate browser storage. Its evidence timestamps are anchored across reloads so ordinary reloads preserve choices. Earlier preview choices had no evidence revisions and are not imported into this history; their findings return for review.

Stopping monitoring a project removes its snapshot, activity, valid GitHub/Codex cache entries, and valid review choices in one transaction. Failed writes leave monitoring intact for retry. An unreadable review ledger is retained until the user resets it; no choice from that ledger is applied. Removing monitoring never invokes branch deletion or changes Git files. Adding the project again starts a fresh inspection.

## Verification

Domain and real SQLite tests cover evidence changes, stable refreshes, exact snooze expiry, restore/reset scope, rejected stale clicks, restart persistence, malformed history, failed saves, and atomic monitoring removal with retry. Local, GitHub, and Codex service tests cover late results after removing/re-adding projects.

Native checks with a temporary fictional Git repository verified dismissal across an app restart, immediate attention-count changes, resurfacing after a new commit, and stopping monitoring while preserving the branch tip and working files. Those removal checks preceded the transaction refinement; the final coordinated removal has SQLite integration coverage, with its native recheck pending. Browser checks reached the last page beyond fifty findings and restored snoozed/dismissed choices. Automated UI regression coverage and the complete AI review lifecycle remain on the roadmap.
