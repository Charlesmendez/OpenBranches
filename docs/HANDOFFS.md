# Agent handoffs

The Needs attention screen can send one branch or a multi-selection to an installed Codex, Claude, or Cursor agent. OpenBranches remains the evidence and routing layer. The coding agent investigates the repository and returns a proposed resolution.

## User flow

1. Select one or more branch rows and choose **Send to…** or **Send all selected to…**. Selections remain active while paging, searching, or moving between review queues. **Select all results** adds every branch in the current filtered result, including branches on other pages.
2. Review the selected provider, number of branches, project task groups, and exact prompt.
3. Send the handoff. OpenBranches creates one task per repository and runs at most two at a time.
4. Follow queued and running work in the attention screen and on every included branch. Expand completed work to read the proposal.

A 500-branch selection in one repository remains one task. A selection across five repositories becomes five tasks because each agent process has one working directory. The bulk bar and confirmation dialog always count the complete selection, including branches that are not on the visible page.

## Evidence and stale-state protection

The renderer sends only repository and branch identifiers. The Electron main process resolves those identifiers against the current snapshot, regenerates deterministic findings, and builds the prompt itself. The preview revision hashes every task, branch, and prompt. Sending fails if the evidence has changed since preview.

Each branch entry includes the current local and remote ref, commit identity and timestamp, integration status for every target, worktree state, PR evidence, bounded linked-task metadata, and the deterministic findings that caused the row to appear. Commit messages, branch metadata, and other repository values are enclosed as untrusted evidence.

## Execution boundary

The first handoff asks for investigation and a proposal. Codex runs with a read-only sandbox and no approval escalation. Claude runs in plan mode. Cursor runs in ask mode without `--force`. The prompt also prohibits edits, commits, pushes, merges, PR closure, and branch deletion. OpenBranches never supplies credentials; each provider uses its own local sign-in.

OpenBranches saves the handoff before starting a process, limits captured output, discards stderr because it may contain private paths, applies a 30-minute deadline, and records an interrupted task as failed on restart. Raw prompts are not written to the handoff ledger. Two provider processes may run concurrently; the rest stay queued.

The implementation follows the providers’ documented non-interactive and planning surfaces: [Codex CLI](https://developers.openai.com/codex/cli/reference/), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/cli-usage), and [Cursor headless CLI](https://docs.cursor.com/en/cli/headless).

## Limits

Installed does not prove that a provider is authenticated or current. A launch or authentication failure appears on the saved handoff without exposing raw provider stderr. Provider subscriptions and usage limits remain controlled by the provider. OpenBranches keeps up to 250 recent repository tasks and at most 40,000 characters of each final proposal.
