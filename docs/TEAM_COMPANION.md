# Mac team sharing

The Mac app connects to an optional OpenBranches team service from Settings. The member approves a device code in the browser, then explicitly selects local projects and team destinations on the Mac. **Pairing alone shares nothing.** Approving the metadata preview enables continuing updates within the selected field choices.

Pairing, project approval, publication, upload status, Stop sharing, and disconnection are implemented. Actual Electron/browser checks with fictional data cover automatic commit updates, process restarts, and an unavailable service. These are not two real member devices or real GitHub authorization. Team mode remains a developer preview; see [the full scope](TEAM_WORKSPACES.md).

## Connection and credentials

The connection coordinator owns pairing, device/account verification, project permissions, and temporary metadata reviews. The fixed-route HTTP client and narrow IPC bridge keep credentials in the main process. The renderer cannot supply a bearer token, arbitrary upload URL, snapshot payload, or replacement approval fields.

The shared secret vault stores encrypted bytes in SQLite preferences using Electron safeStorage; on macOS, Keychain protects the encryption key. Device credentials, opaque-key secrets, and sharing choices use separate app-owned records. GitHub credentials retain their existing key. There is no plaintext fallback. Signed-app upgrade and credential migration checks remain release requirements.

Users enter the origin themselves. Packaged builds require HTTPS and reject paths, query strings, account details, and redirects. Loopback HTTP is allowed only in development. Requests omit browser cookies, have a 15-second timeout, and accept at most 2 MB of validated JSON. Arbitrary server error bodies are not displayed. Pairing expires after ten minutes; manual refresh cannot bypass its polling interval.

The device-only companion endpoint returns the verified account/device, accessible projects, and its own sharing state. Responses must match the paired workspace, member, and device. An absent record is never assumed when the sharing list is incomplete.

## Review and approval

The member searches monitored projects and explicitly chooses a team-issued destination. Display names never join projects automatically. Task titles and summaries have independent choices, both initially off. Changing choices or destinations clears the preview. Removing the local project or losing sharing permission also invalidates the displayed review.

The shared snapshot preparation module supplies preview and publication with the same field whitelist. The preview shows branch counts, observation time, omitted entries, scan errors, and complete JSON. Per-connection HMAC keys replace raw branch/task IDs. Paths, remote URLs, prompts, source, diffs, commit subjects, and arbitrary evidence are excluded. Branch names and commit IDs can still disclose work and are visible for review. When the local Codex connection supplies it, the snapshot also carries bounded task status, waiting state, checked time, and `codex-runtime` provenance; the server rejects inconsistent tool/provenance combinations.

The main process retains a short-lived, single-use review of the exact connection, repository, destination, choices, and observed sharing epoch. It does not persist the preview snapshot. Approval accepts only that review ID, rechecks access, expiry, monitoring and epoch, and saves the binding before any enabling request. Later snapshots use the currently monitored repository within those field choices. The UI explicitly explains that approval permits continuing updates.

One device maps at most one local repository into a given team destination. Stop its existing share before replacing that mapping or its text choices. There are at most 200 sharing records across ten connections; stopped records can be removed. Renaming a local or team project updates its label without changing the identity binding.

## Background publication

The publisher coordinates reviewed bindings and network work; its separate sharing registry owns persistence and prepared transaction writes. Five-second passes process at most four due projects, rotate fairly, and coalesce concurrent refreshes. A project normally has at least 30 seconds between automatic attempts. Projects in a pass share one fresh companion read per connection. Failures back off to at most five minutes; an explicit status refresh can retry sooner.

Unchanged metadata is not resent for two minutes. New observations or commits can be sent on the next due pass. Observation time remains the scanner's time: a recent upload never makes an old scan look current. The server separately validates freshness, size, choices, permissions, and credentials. The Mac shows the last acknowledged upload and its observation time; the team browser labels outdated reports.

A lost enable reply is reconciled against the expected next consent epoch and identical choices. Upload sequences are reserved before sending and advance beyond both the local reservation and the server's received sequence after interruption. Old requests cannot overwrite newer sequences. A changed or withdrawn share pauses; restoring permission does not automatically re-enable it.

The publisher persists bindings, choices, ordering, content digests, and acknowledgement times. It does not save a queue of snapshot payloads. Each attempt prepares current approved metadata again and rechecks monitoring and connection state after asynchronous work. Closing or disconnecting prevents late responses from starting another upload.

## Stop sharing and removal

Stop sharing first saves the withdrawal intent and cancels in-flight work. Remote withdrawal retries across restarts. Reports may remain visible until acknowledgement, so the Mac explicitly shows Withdrawal pending. A disabled epoch also fences an uncertain first enable that has not reached the service yet; observing an absent share alone would not suffice. A device may create only its own empty withdrawal record for a project in its workspace after losing access. This grants no permission to enable or publish.

If saving Stop sharing fails, this running process pauses uploads and shows that the stop is unsaved. Persistence is retried, and the UI tells the user to keep the app open and retry before restarting. Durable cancellation cannot be promised when the storage write itself failed.

Stopping local monitoring prepares withdrawal for all of that repository's shares in the same SQLite transaction as removal and cache cleanup. Memory, watchers, and publisher cancellation change only after commit. Unreadable sharing choices prevent removal until resolved, so re-adding a project cannot silently revive an approval whose cancellation was never saved. Stop sharing alone keeps local monitoring active. Neither action modifies Git refs, indexes, files, or worktrees.

Disconnecting persists its removal intent before contacting the service and survives approval/cancellation races and outages. Confirmed revocation withdraws device reports and marks its sharing records stopped. Forgetting an unavailable connection or sharing record is a separate reviewed action; it cannot guarantee remote withdrawal. The UI directs the member to the owner for device revocation when needed.

## Verification

The first publisher milestone passed 223 desktop/domain/client tests and 30 PostgreSQL/HTTP team tests, both builds, type checks, formatting, and diff checks. Current suite totals are recorded in `TEAM_SERVICE.md`. Publisher checks cover live/expired/changed reviews, field choices, failed persistence, lost replies, upload order, late cancellation, offline withdrawal, wrong-project acknowledgements, permission restoration without re-enabling, unsaved Stop recovery, atomic removal, corrupt choices, label changes, explicit retry, fair bounded passes, and refresh coalescing. The database test verifies withdrawal after access loss, rejection of a late enable, and tenant isolation.

Actual Electron/Chrome checks with isolated fictional data verified:

- Code approval under the expected team/member/device, followed by a 229-branch preview and publication. The browser gained those reports automatically.
- Branch details under the reporting Mac, separate tools/models, task text absent by default, and titles present with summaries off when selected.
- Fresh verified Codex runtime evidence appears as working or waiting, expires after 90 seconds, and never derives from dirty files or commit recency.
- Stop sharing changed the Mac to Stopped and removed both the searched branch and its open browser details.
- A simulated commit updated the browser without manually refreshing publication.
- A real Electron-process restart preserved the project, credential, choices, opaque branch identity, and upload status. Another simulated commit was published after restart.
- Pausing the owned service left withdrawal pending. Restarting the Mac while it was paused preserved that intent. Resuming the service completed withdrawal automatically and removed the report.
- Shared-project search, clearing search, disconnection, and removing a stopped record worked. Temporary app/data directories, the browser tab, and the owned database were cleaned up afterward.

These checks used fictional accounts and repositories on one physical Mac. They did not authorize a real GitHub App, share personal data, or satisfy real two-member/device acceptance. Transactional project removal and revoked-permission recovery have automated evidence; broader native scenarios, accessibility, and load testing remain required.

## Reproduce the native fixture

With macOS, Node.js 24, root/team dependencies, and Docker, run these in separate terminals:

    npm run team:preview
    npm run team:preview:mac

Enter the service's printed loopback address in the Mac window. The native fixture uses production connection, publisher, IPC, and encryption code with fictional repositories. Its separate preload adds simulated-commit and real-process-restart controls. The parent launcher retains its private data for requested restarts; closing the fixture or stopping its launcher removes its temporary bundle and data. Installed Electron and the regular app's storage remain unchanged. Fixture entry points are excluded from production bundles.

## Remaining release gates

Real GitHub authorization and two real member devices, native permission-revocation/project-removal scenarios, broader accessibility and load checks, GitHub installation/organization ingestion, company alerts, deployment upgrades/recovery, and signed distribution remain required. A green fictional flow alone is not a company release.
