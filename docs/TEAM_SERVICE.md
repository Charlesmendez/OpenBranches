# Team service: developer API preview

The optional service now implements GitHub browser identity verification, workspace membership, scoped device pairing, project permissions, selected metadata snapshots, revocation, and live invalidation events. It uses PostgreSQL and a separate Node.js process. Personal desktop use does not install or connect to it.

This is an **API preview**. There is no browser administration screen or Mac pairing/publishing interface yet. GitHub App installation ingestion, organization membership synchronization, company PR alerts, and real two-member/device verification remain incomplete. Running this service does not automatically share any desktop projects. Do not describe it as a usable team release.

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

The API requires a registered GitHub App. Configure the callback to exactly `<OPENBRANCHES_TEAM_ORIGIN>/auth/callback`. Identity sign-in follows GitHub's [web flow with state and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app). This milestone reads the signed-in user's identity and publicly resolves member logins; it does not use repository installation permissions yet. Keep the client secret on the service host. It is never bundled into the Mac app.

Copy `team-service/.env.example` to `team-service/.env` and fill the empty settings. The owner setting is a stable numeric GitHub user ID, not a login. Use a random hex database password so it is safe inside the connection URL. Then, from the repository root:

```sh
docker compose --env-file team-service/.env -f team-service/compose.yaml up --build -d
```

The example listens on `127.0.0.1:4389`, keeps PostgreSQL private on the container network, and stores its data in a named volume. Check `/health`, then open `/auth/github` to sign in. The callback currently displays `/api/session` JSON. Further actions are API operations until the administration screen is implemented.

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

The future Mac companion must store device credentials and opaque-key secrets in the OS credential store, scope them to the chosen HTTPS origin, and default every project to unshared. Team project IDs are issued by the service; names alone must never join unrelated local repositories.

`src/team/prepareSnapshot.ts` supplies the metadata preview and publisher with the same field whitelist. The caller must provide HMAC keys derived from a private per-device secret. Default data includes branch names, commit IDs, local/remote presence, working-copy counts, target ancestry, and recorded tool/model associations. Those names and identifiers can themselves reveal work, so the user must see a preview before enabling sharing. Paths, remote URLs, raw task/session IDs, commit subjects, prompts, diffs, source files, tool output, and arbitrary evidence fields are omitted. Task titles and summaries require independent choices. Unknown working-file state remains unknown.

Changing sharing settings increments a consent epoch and clears the old snapshot. Uploads must carry the current epoch and a strictly increasing sequence. The server independently rejects task text outside the stored choices, old epochs, duplicate sequences, and revoked permissions. After an uncertain upload response, read the sharing state before retrying. Canceling a pairing that races approval may return a conflict; retry cancellation to revoke the newly paired device. Offline publishers must recheck both local consent and server state before uploading queued metadata.

Snapshots contain at most 1,000 local branch entries, ten task associations per branch, and eight integration targets, with omitted counts and a 750 KB preparation budget. The server enforces a 768 KB serialized snapshot limit and an 800 KB HTTP request limit. Work pages contain up to ten snapshots and a continuation cursor. Workspace/project/people/device lists report completeness at their bounds; consumers must display partial coverage and must restart pagination if the workspace revision changes.

Events carry only an invalidation revision. Each event and 20-second heartbeat rechecks authorization before a client reads fresh data. Database disconnects retry every three seconds and invalidate missed changes after reconnecting. A last snapshot older than five minutes, an expired device credential, a failed scan, or an invalid/future clock is stale; recent metadata does not prove someone is actively working.

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
| List / revoke devices               | `GET /devices`, `DELETE /devices/:deviceId`                                    |
| Add / remove members                | `POST /members`, `DELETE /members/:memberId`                                   |
| Create / remove local team projects | `POST /projects`, `DELETE /projects/:projectId`                                |
| Grant project read/sharing access   | `PUT /projects/:projectId/access/:memberId`                                    |
| Read / change device sharing        | `GET /shares`, `PUT /shares/:projectId`                                        |
| Publish selected metadata           | `POST /shares/:projectId/snapshots`                                            |

## Verification and remaining gates

Automated PostgreSQL and HTTP tests cover tenant isolation, distinct member/device identities, project permissions, state/PKCE and callback replay, CSRF, scoped device powers, stored consent, upload order, unsharing races, authorization after a queued revocation, restart behavior, revocation events, stale devices, pagination, and bounded coverage. Reconnection tests simulate repeated outages and shutdown races. GitHub responses in OAuth tests are fictional injected provider responses; real GitHub browser authorization is not yet verified.

At this milestone, 189 desktop/domain tests and 25 team tests pass, as do both builds, type checks, formatting, and the team runtime dependency audit. A local ARM64 container check verified the non-root read-only runtime, initial migration, health endpoint, anonymous session denial, and pending pairing persistence across an actual process restart. Its database and network were disposable fictional fixtures and were removed afterward. GitHub-hosted CI is configured separately; its result must be checked on the pushed commit.

Before calling team mode complete: implement the administration and Mac sharing flows, GitHub installation and organization ingestion, local publication/recovery, company alerts, actual registered-app sign-in, two real member devices, offline/unshare/revoke UI verification, load testing, deployment upgrades, and native accessibility. See the full [team acceptance criteria](TEAM_WORKSPACES.md) and [release roadmap](ROADMAP.md).
