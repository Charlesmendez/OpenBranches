# Team service: developer preview

The optional service now implements GitHub browser identity verification, workspace membership, scoped device pairing, project permissions, selected metadata snapshots, revocation, and live invalidation events. Workspace owners can verify authority over a GitHub user or organization installation, search its repository catalog, review exact choices, save stable selections, and remove them. It uses PostgreSQL and a separate Node.js process. Personal desktop use does not install or connect to it.

The service includes a **browser workspace preview**: live-runtime highlights, grouped shared branch reports, permission-aware search and totals, a focused branch inspector, a read-only GitHub branch/PR explorer, people/project administration, pairing approval, device revocation, and the owner GitHub-selection flow. Selected GitHub repositories refresh in the background and show bounded status and branch/open-PR counts. The [Mac companion](TEAM_COMPANION.md) pairs, previews and approves selected metadata, publishes background updates, shows upload status, and withdraws sharing. Organization membership synchronization, company alerts, and real two-member/device verification remain incomplete. Running this service does not automatically share any desktop projects. This is not a usable team release yet.

## Try the fictional team

With Node.js 24, root and team dependencies installed, and Docker running:

```sh
npm run team:preview
```

Open the loopback URL printed in the terminal. The preview creates its own disposable database containing eight fictional people, four projects, and 400 branch reports. Its visible banner switches between an owner and a member account. A temporary pairing code is printed for reviewing device approval. Permission changes, project removal, and device revocation operate on this fictional database through the real service API. Reports age naturally and become outdated after five minutes; restart the preview for fresh fixtures. Ctrl-C stops the process and its owned database container.

This command does not read local repositories or use real GitHub accounts. Its fixture sign-in routes exist only in the development entry point, which is excluded from the production container. Never expose the fictional preview on a shared host. It verifies browser interaction with synthetic data, not actual GitHub authorization or separate Macs.

## Browser behavior

Fresh, verified runtime observations appear in a `Happening now` rail directly below navigation. Choosing one applies its exact person, project, and branch filters. Groups with current work sort first, the leading group opens automatically, and active or waiting branches appear first with blue or violet evidence states. Other groups stay collapsed; each initially shows eight reports and expands in batches. Search covers branch names, commit IDs, people, projects, recorded tools/models, and explicitly shared task titles. Counts and results use the same project permissions. A report is one device's observation; two devices reporting the same branch remain separate reports.

Details show the reporting person/device, observed and received times, recorded coding tools/models, working-copy counts, and independent integration-target ancestry. Ancestry does not prove squash-merge equivalence, ownership, or live activity. Disconnected or old reports remain visibly outdated.

Live events invalidate the view after committed changes. The browser coalesces refreshes, polls once a minute while visible for time-dependent totals, and displays reconnection state. Filter changes cancel obsolete reads. Paginated results must share a workspace revision; otherwise the browser restarts the read. Pages have an 8 MB response bound; a loaded view stops at ten pages or 16 MB and asks the viewer to narrow the scope. Workspace data stays in memory and is cleared when access is revoked. Incomplete lists and omitted branches remain explicit.

Owners can add/remove people and team projects and separately grant viewing or sharing access. Members see their available projects and only their own devices. Pairing approval shows the account, team, and device before confirmation; pairing alone enables no project sharing. Removing a project or revoking a device withdraws shared reports without modifying Git repositories.

## Run the tests

From the repository root, use Node.js 24 and Docker:

```sh
npm ci
npm run team:install
npm run team:typecheck
npm run test:team
```

The team test command starts a uniquely named PostgreSQL 18 container, publishes a random loopback port, uses a random temporary password and a temporary filesystem, runs the tests, then stops that container. It never selects an existing user database automatically. It requires Docker unless `OPENBRANCHES_TEAM_TEST_DATABASE_URL` explicitly identifies a dedicated test database. The CI workflow uses an isolated PostgreSQL service with fictional credentials. Tests insert fictional records and run the service migration; never point them at a personal or production database.

`npm test` remains the desktop/domain suite and includes sharing-metadata preparation tests. `npm run test:team` separately exercises the actual database, HTTP server, OAuth protocol, and reconnection behavior. Missing infrastructure fails visibly rather than skipping the integration tests.

## Run the service

The API requires a registered GitHub App. Configure the callback to exactly `<OPENBRANCHES_TEAM_ORIGIN>/auth/callback`. Identity sign-in follows GitHub's [web flow with state and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app). Keep the client secret and optional repository-reading private key on the service host. They are never bundled into the Mac app.

Copy `team-service/.env.example` to `team-service/.env` and fill the settings. The owner setting is a stable numeric GitHub user ID, not a login. Use a random hex database password so it is safe inside the connection URL. The optional GitHub repository flow also requires an existing GitHub App private-key file outside the repository. Then, from the repository root:

```sh
docker compose --env-file team-service/.env -f team-service/compose.yaml up --build -d
```

To enable the owner GitHub repository-selection flow, include the secret-file overlay:

```sh
docker compose --env-file team-service/.env -f team-service/compose.yaml -f team-service/compose.github.yaml up --build -d
```

Without that overlay, team sign-in and opted-in local sharing remain available, while the GitHub Projects tab explains that its host setup is incomplete.

The example listens on `127.0.0.1:4389`, keeps PostgreSQL private on the container network, and stores its data in a named volume. Check `/health`, then open `/` for the browser workspace. Continue with GitHub to sign in; the callback returns to the workspace. The server serves only the three fixed build assets, with a same-origin content security policy and no inline scripts.

For a shared host, place an HTTPS reverse proxy in front of the loopback listener, preserve the configured Host header, and disable response buffering for `/api/workspaces/:id/events`. Set `OPENBRANCHES_TEAM_ORIGIN` to that exact public HTTPS origin. Remote HTTP origins are rejected. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS; browser mutations require the exact Origin header. No forwarded client address is trusted: the current per-address rate limit is shared by clients behind the proxy. Proxy limits and scale/load verification remain release work.

Container images are pinned to verified official Node 24 and PostgreSQL 18 digests. The runtime runs as a non-root user with a read-only filesystem in Compose. PostgreSQL 18 uses `/var/lib/postgresql` for its volume, following the [official image documentation](https://hub.docker.com/_/postgres). Revalidate image versions and advisories before a release. No public image has been published.

The API can also run directly with configured environment variables and a dedicated PostgreSQL database:

```sh
npm run team:install
npm run team:build
npm run team:start
```

Use `docker compose --env-file team-service/.env -f team-service/compose.yaml stop` to stop the example while retaining its database. Backups and restoration are the host operator's responsibility; backup retention and restoring revoked credentials need an explicit policy before production. Unsharing removes the active database snapshot; it cannot retract copies another authorized viewer already read or copies in a host's backups.

## Authentication and permissions

The initial configured owner can create workspaces and add members by verified GitHub account ID. A member has to sign in as that GitHub account; knowing a login or workspace UUID grants no access. Owners grant read and, independently, local-sharing access to each team project. Removing a member or project permission withdraws affected snapshots and invalidates their sharing versions. Re-adding a member does not revive device credentials or old shares.

A device starts pairing and displays a short code. The authenticated member first inspects the device name, then approves that code into a specific workspace. Pairing expires after ten minutes, polls are limited to once per five seconds, and approval is single-use. The pairing secret becomes that device's scoped credential only after approval. Device credentials expire after 90 days, cannot administer the team, and never contain a GitHub token. Database records store hashes of browser/device secrets. GitHub access and refresh tokens are neither persisted nor sent to devices.

A device may revoke itself; members may revoke their own devices; an owner browser session may revoke any workspace device. Revocation clears the published local work atomically. API errors and event payloads do not expose credentials, SQL text, paths, or snapshots.

## Companion contract

The Mac companion stores encrypted device credentials and opaque-key secrets in its own preferences, using Electron safeStorage with a macOS Keychain-protected key. Credentials are scoped to the chosen HTTPS origin and every project remains unshared until its preview is explicitly approved. The device-only `GET /companion` endpoint supplies its verified identity, accessible projects, and own sharing versions. Team project IDs are issued by the service; names alone never join unrelated local repositories. See [native behavior and verification](TEAM_COMPANION.md).

`src/team/prepareSnapshot.ts` supplies the metadata preview and publisher with the same field whitelist. The caller must provide HMAC keys derived from a private per-device secret. Default data includes branch names, commit IDs, local/remote presence, working-copy counts, target ancestry, recorded tool/model associations, and a task's bounded status/runtime provenance when available. Those names and identifiers can themselves reveal work, so the user must see a preview before enabling sharing. Paths, remote URLs, raw task/session IDs, commit subjects, prompts, diffs, source files, tool output, and arbitrary evidence fields are omitted. Task titles and summaries require independent choices. Unknown working-file state remains unknown.

Changing sharing settings increments a consent epoch and clears the old snapshot. Uploads must carry the current epoch and a strictly increasing sequence. The server independently rejects task text outside the stored choices, old epochs, duplicate sequences, and revoked permissions. After an uncertain upload response, read the sharing state before retrying. Canceling a pairing that races approval may return a conflict; retry cancellation to revoke the newly paired device. Offline publishers recheck local consent and server state before preparing current approved metadata. A device may create its own empty disabled record for a project in its workspace after losing permission, fencing a canceled first enable without gaining upload access.

Snapshots contain at most 1,000 local branch entries, ten task associations per branch, and eight integration targets, with omitted counts and a 750 KB preparation budget. The server enforces a 768 KB serialized snapshot limit and an 800 KB HTTP request limit. Work pages contain up to ten snapshots and a continuation cursor. Workspace/project/people/device lists report completeness at their bounds; consumers must display partial coverage and must restart pagination if the workspace revision changes.

Events carry only an invalidation revision. Each event and 20-second heartbeat rechecks authorization before a client reads fresh data. Database disconnects retry every three seconds and invalidate missed changes after reconnecting. A last snapshot older than five minutes, an expired device credential, a failed scan, or an invalid/future clock is stale. A live label additionally requires a verified Codex branch association, explicit `codex-runtime` provenance, and a runtime check no older than 90 seconds. Dirty files, recent commits, and saved task links never become live presence.

## API surface

All workspace operations are scoped to `/api/workspaces/:workspaceId`. Browser sessions use cookies and exact-Origin mutations. Device APIs use the approved credential as a Bearer header. Every write body is strict JSON.

| Operation                           | Endpoint                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Start/finish sign-in                | `GET /auth/github`, `GET /auth/callback`                                       |
| Read session / sign out             | `GET /api/session`, `DELETE /api/session`                                      |
| Create workspace (instance owner)   | `POST /api/workspaces`                                                         |
| Start / poll / cancel pairing       | `POST /api/pairings`, `GET /api/pairings/current`, `POST /api/pairings/cancel` |
| Inspect / approve pairing (browser) | `POST /api/pairings/inspect`, `POST /api/pairings/approve`                     |
| Read work / events                  | `GET /view`, `GET /events`                                                     |
| Read own companion profile (device) | `GET /companion`                                                               |
| List / revoke devices               | `GET /devices`, `DELETE /devices/:deviceId`                                    |
| Add / remove members                | `POST /members`, `DELETE /members/:memberId`                                   |
| Create / remove local team projects | `POST /projects`, `DELETE /projects/:projectId`                                |
| Grant project read/sharing access   | `PUT /projects/:projectId/access/:memberId`                                    |
| Read project access (owner browser) | `GET /projects/:projectId/access`                                              |
| Read / change device sharing        | `GET /shares`, `PUT /shares/:projectId`                                        |
| Publish selected metadata           | `POST /shares/:projectId/snapshots`                                            |

## Verification and remaining gates

Automated PostgreSQL and HTTP tests cover tenant isolation, distinct member/device identities, project permissions, state/PKCE and callback replay, CSRF, scoped device powers, stored consent, upload order, unsharing races, authorization after a queued revocation, restart behavior, revocation events, stale devices, pagination, and bounded coverage. Reconnection tests simulate repeated outages and shutdown races. GitHub responses in OAuth tests are fictional injected provider responses; real GitHub browser authorization is not yet verified.

The desktop/domain/client and team suites run with both builds, type checks, and formatting required. Checks cover permission-aware search and totals, literal search characters and displayed tool names, owner-only project-access reads, fixed public assets, client response bounds, consistent pagination, native connection recovery, companion identity scoping, publisher persistence and cancellation, bounded scheduling, withdrawal fencing after access loss, and the GitHub provider and refresh boundaries. A local ARM64 container check at the browser milestone verified the non-root read-only runtime, initial migration, browser assets and content security policy, absence of the fixture server and public development routes, health endpoint, anonymous session denial, and pending pairing persistence across an actual process restart. The check used disposable fictional services and removed them afterward. GitHub-hosted CI must be checked on the pushed commit.

Browser checks against the isolated 400-report fixture verified collapsed groups, search with retained input focus, project filtering/grouping, loading additional snapshots, branch details, pairing review and approval, member device visibility, and revocation. Removing a member's access to Payments removed that project and its reports from their view; revoking their reporting Mac withdrew the remaining reports. Responsive checks covered desktop, tablet, and 390-pixel layouts without horizontal overflow. These fictional identities and device records do not satisfy real two-member/device acceptance.

Native pairing, approval, publication, automatic commit updates, process restarts, offline withdrawal, search, and disconnection have also been verified with fictional repositories and an isolated Electron app. Before calling team mode complete: finish the permission-aware GitHub branch/PR explorer and organization ingestion, company alerts, actual registered-app sign-in, two real member devices, broader native permission-revocation/project-removal checks, load testing, deployment upgrades, and native accessibility. See the full [team acceptance criteria](TEAM_WORKSPACES.md) and [release roadmap](ROADMAP.md).
