# Mac team connection and metadata preview

The Mac app now connects to an optional OpenBranches team service from Settings. It requests a code, opens the selected service in the browser, waits for the signed-in member to approve this Mac, and displays the resulting team/account/device identity. Connecting does not share projects.

This milestone includes pairing, permission-aware project discovery, a local metadata preview, cancellation, disconnection, and forgetting an unavailable connection. **Background publication is not implemented yet.** The preview is labeled accordingly and never uploads a snapshot. The browser workspace and service remain developer previews; see [team scope](TEAM_WORKSPACES.md).

## Connection and storage

`electron/team/` owns the connection coordinator, fixed-route HTTP client, origin validation, and narrow IPC handlers. Device credentials and the secret used to derive opaque branch/task keys remain in the main process. The renderer receives only public connection state and sanitized previews.

`electron/services/secretVault.ts` is shared with the existing GitHub vault. It stores encrypted bytes in the app's SQLite preferences using Electron `safeStorage`; on macOS, the encryption key is protected through Keychain. It does not store plaintext credentials or fall back to plaintext when encryption is unavailable. The GitHub storage key remains unchanged. Unreadable saved team state fails closed and can be retried after unlocking Keychain. Signed-app upgrade and credential migration checks remain release requirements.

Users enter the team origin themselves. Packaged builds require HTTPS and reject paths, query strings, account details, and redirects. Explicit loopback HTTP is allowed only for development. Device requests omit browser cookies, have a 15-second timeout, and accept at most 2 MB of validated response JSON. Arbitrary server error bodies are not displayed. Pairing codes expire after ten minutes; manual refresh cannot bypass the server's polling interval.

The service's device-only companion endpoint returns the verified account/device, accessible projects, and that device's sharing state. It does not return other members' snapshots. A response must match the paired workspace, member, and device. Lists expose incomplete coverage.

## Review before sharing

The member searches their monitored local projects, explicitly chooses a team destination, and prepares a preview. Display names never automatically join local and team projects. Task titles and summaries have separate choices, both off initially. Changing either choice or destination clears the preview. Removing the local project or losing project sharing permission also clears it.

Preview preparation rechecks current service access and the monitored repository, then calls the shared field whitelist in `src/team/prepareSnapshot.ts`. The summary shows branch report counts, observation time, omitted entries, and scan errors, with expandable complete JSON. Branch and task keys are derived from a per-connection HMAC secret; raw local IDs and paths are excluded. Names and commit IDs can still disclose work and are visible for review.

The displayed preview ID and expiry are not a saved authorization to publish. The future publisher must bind approval to the exact connection, local repository, team project, and text choices, and recheck permissions before sending. No scan or timer currently publishes local metadata.

## Disconnect and recovery

Disconnect persists the local removal intent before making the remote request. It waits for earlier connection work and retries cancellation if browser approval raced it. A late pairing response cannot restore a locally canceled connection. Offline removal remains pending across restarts until the service acknowledges it. Successful device revocation withdraws that device's shared reports through the existing service transaction.

An expired or revoked credential becomes unavailable. Forgetting is a separate reviewed action: it removes the saved local connection but cannot guarantee remote withdrawal. The UI directs the member to the team owner if remote removal is still needed. None of these actions modifies Git refs, worktrees, files, or local project monitoring.

## Verification

Automated connection checks exercise origin and redirect boundaries, cookie/credential isolation, malformed and oversized responses, identity mismatches, non-JSON authorization failures, polling limits, approval/cancellation races, offline removal restart, storage failure, revoked devices, permission-checked previews, stable opaque keys after restart, and encryption failure without plaintext fallback. The companion database test checks account/device scoping, project permissions, browser denial, and device revocation. Regression suites contain 208 desktop/domain/client tests and 29 team tests at this milestone.

An actual Electron window and Chrome browser were verified against the isolated fictional team service:

- The Mac requested a code; the member inspected the account/team/device and approved that code in the browser.
- The Mac displayed the paired identity and permitted projects.
- Selecting the fictional `atlas-api` project and `Atlas Web` destination produced 229 branch reports with both task-text choices off. The complete-preview control was inspected through native accessibility; automated whitelist checks cover the payload fields.
- The browser continued to show no received report, confirming that pairing and preview did not publish a snapshot.
- Changing a task-text choice cleared the previous preview.
- Disconnecting removed the native connection card and changed the browser device to Revoked.

This used fictional repositories, a temporary app identity and data directory, and a disposable PostgreSQL instance. It did not authorize real GitHub accounts, publish personal work, or exercise two physical Macs. It is not the required real two-member/device acceptance test.

To reproduce on macOS with Node.js 24, the root/team dependencies, and Docker installed, run these commands in separate terminals:

```sh
npm run team:preview
npm run team:preview:mac
```

Enter the first command's loopback address in the native window. The native script copies the installed Electron runtime into its own temporary bundle, gives it a distinct development identity, and uses production connection, IPC, and encryption code with fictional repositories. It does not change the installed runtime or the regular app's data. Closing the fixture or stopping its process removes its owned temporary data. The production build excludes the fixture entry points.

## Remaining publisher requirements

Implement durable explicit project bindings and review approval; consent epochs and monotonic upload sequences; bounded/coalesced background publication; uncertain-response reconciliation; immediate durable local Stop sharing with offline withdrawal; permission/revocation recovery without automatic re-enabling; and coordination with stopping local monitoring. Verify these through the native UI and the service before enabling publication. GitHub installation/organization ingestion, company alerts, real member/device checks, native accessibility, and signed distribution remain separate release gates.
