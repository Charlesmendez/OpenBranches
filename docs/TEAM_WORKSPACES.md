# Personal and team workspaces

OpenBranches is being extended with automatic project discovery, search and removal across projects, multiple coding agents with recognizable icons, and a company view of people, branches, PRs, and alerts. Team workspaces will combine **GitHub plus opted-in unpublished local work**. These requirements extend the existing desktop, AI, and release scope.

## Experience

The workspace switcher will offer Personal and a named team. Personal mode continues to work locally without a server or company account. A team overview groups work by person, project, or attention state. Each person can be expanded into their projects and branches, with PR state and coding-tool badges. Search spans people, projects, branch names, and PRs; filters narrow to a person, project, tool, or attention state. Hundreds of branches remain grouped with progressive disclosure and virtualized lists.

Team alerts include PRs awaiting review, failing checks, stale drafts, merged PRs with remaining branch copies, unpushed work reported by a member, and work that appears forgotten. Every alert states its evidence and last observation; users can snooze or dismiss it. Closing PRs, deleting branches, and merging remain user decisions outside the read-only first release.

Local onboarding discovers saved coding-tool projects and offers a single follow setting. It does not require selecting each folder. Projects can be searched and removed; removal must prevent automatic re-addition after refresh, restart, or a late scan. Stopping local monitoring and stopping team sharing are distinct actions.

## Identity and evidence

Keep three independent identities: the person, the coding tool, and the underlying model. Codex, Claude Code, an editor using Grok, and another tool must not be conflated. A branch can have multiple tools and multiple contributors. Model identity is shown only when the source reports it.

Provider adapters return normalized project, task, and activity evidence with source, checked time, confidence, and optional model. Codex saved-task metadata is one adapter. Claude Code needs a separately verified local metadata or opt-in event adapter. Grok and other models may run inside another tool; support comes from that tool's adapter or a documented OpenBranches event protocol. Do not infer a provider from a branch prefix, a configured model, the presence of an instruction file, or ordinary commit author text. Unknown and historical associations remain visible as such. Use bundled, licensed provider icons with accessible names and text fallbacks; do not load arbitrary icon URLs from repository data.

GitHub identifies PR authors and reviewers, not the owner of all work on a branch. Commit attribution is labeled as commit attribution. An opted-in device can identify who is currently reporting local work. Recent commits alone cannot establish live activity. A disconnected device becomes stale/unknown rather than idle or finished.

## Shared service and local companion

The same Mac app is the local companion. A company runs an optional open-source team service that receives selected metadata from members' devices and reads GitHub through a registered GitHub App. The initial hosting target is a documented container deployment with PostgreSQL, an authenticated API, and streamed incremental updates. Personal use needs none of this infrastructure.

The companion pairs with a specific team and member account. Each member explicitly selects the projects they share. Default shared fields are repository identity, branch/commit identifiers, local/remote presence, dirty-state counts, reported agent evidence, and source freshness. Task titles or summaries require a visible sharing choice; full prompts, source files, diffs, credentials, and absolute local paths are not uploaded by default. The app must show a reviewable preview of the shared metadata and provide an immediate Stop sharing control.

The server enforces tenant membership and project permissions for every read, write, and stream subscription. Device credentials are scoped, revocable, and stored in the OS credential store. Transport is encrypted. Project identity uses stable provider IDs or team-issued IDs, rather than ambiguous display names. Snapshot sequence/version checks prevent old device uploads from restoring revoked or unshared work. Unsharing removes the published local snapshot and invalidates in-flight uploads. Offline devices queue only approved metadata and recheck authorization before sending it.

GitHub membership, reviewers, PR state, CI/check results, and permissions must be fetched and validated through supported APIs. The server must not receive members' personal Codex or Claude credentials. Team credentials and GitHub App secrets are never embedded in the desktop bundle or public repository.

## Delivery and acceptance

1. Automatic local discovery, global project search, and durable removal exclusions.
2. Common attribution model and verified Codex/Claude adapters, extensible event ingestion, and accurate multi-agent icon presentation.
3. GitHub people/PR/check evidence and the team UI using clearly fictional fixtures.
4. Authenticated shared service, team membership, device pairing, scoped project sharing, and streaming snapshots.
5. Real two-member verification across separate devices: publish selected work, observe it in the team view, disconnect, revoke, unshare, race old uploads, and prove that personal/unselected data never appears.
6. End-to-end alerts, stale-source behavior, access isolation, packaged clients, and reproducible self-host installation documentation.

These are implementation stages, not claims of completion. Team service, Claude/Grok attribution, sharing, and company alerts are not implemented yet. Existing Git scanning already lists branches independently of the tool that created them; verified tool attribution is separate work.
