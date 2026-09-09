# Connection setup

## GitHub

Public GitHub reading is available in Settings without sign-in. It only reads remotes of repositories you selected; GitHub's unauthenticated rate limits apply. Private repositories require GitHub App authorization.

The inspector separates local and published branch history. GitHub comparisons load incrementally and reuse exact commit evidence. Pending counts and saved snapshot times remain visible; repositories with many uncached commits may need multiple refreshes. See [history checks and their limits](GITHUB_HISTORY.md).

Maintainers must register a public GitHub App before distributing sign-in-enabled builds:

- Enable device flow.
- Request repository Metadata (read), Contents (read), and Pull requests (read). Do not grant write permissions.
- Keep expiring user tokens enabled.
- A webhook server is not needed for periodic desktop refresh; disable webhook delivery if none is configured.
- Users choose the repositories that the app installation can access.
- Build with the public `GITHUB_APP_CLIENT_ID`. Do not embed a client secret, private key, access token, or refresh token.

Device-flow tokens can be refreshed without a client secret. The application polls at the provider's minimum interval, respects slow-down responses, and discards authorization that completes after disconnect. Tokens never cross the renderer bridge.

Disconnect clears the app's saved credentials and GitHub cache. It does not revoke the app installation on GitHub; users can manage that independently in their GitHub account settings.

References: [GitHub device authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [token refresh](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Codex

Connect **Codex tasks** in Settings to read saved task metadata from the installed Codex app-server. Version 0.144.4 is the oldest verified protocol; older, prerelease, and unknown major versions are not accepted. Discovery checks standard Mac installation locations and the inherited executable path. It does not require a separate API key or initiate sign-in.

The inspection client uses a private stdio connection and only allows initialization, task listing, and account inspection. Discovery invokes task listing only, includes current and archived sources, and uses `useStateDbOnly` to avoid scanning and repairing conversation logs. It never starts or resumes a thread, starts a model turn, changes Codex settings, or approves a server-initiated action. Hooks, apps, plugins, shell tools, and multi-agent execution are disabled for this inspection process. These controls are specific to inspection; the AI advisor needs a separately verified execution boundary before it can be enabled.

The local index is checked once per minute, with a 60-second pagination window, 15-second request timeouts, at most 5,000 current and 5,000 archived entries, and bounded protocol messages. The UI labels incomplete results. Initial prompts, conversation bodies, rollout paths, and runtime status are discarded. Origin URLs are reduced to GitHub repository identity, removing credentials and query strings. Only metadata associated with selected projects is retained in OpenBranches' local database.

A verified saved link requires a matching repository/worktree path, branch name, and local or remote commit. A matching GitHub origin and branch in a missing or different worktree, or a changed commit, produces a possible association. Detached worktrees require the same path and commit. Branch names alone never prove a link. Multiple tasks can appear on one branch, including archived tasks; the inspector explains each match.

Saved metadata is historical evidence, not proof that Codex is currently running or owns the branch now. Tasks without sufficient saved metadata may not appear. A separate inspection process cannot establish live activity in another Codex window. Unpublished cloud work and other computers are outside this local connection.

Account status and shared usage allowance are checked after task discovery and shown in Settings. Missing usage remains unknown; account emails, credentials, and reset-credit details are discarded. These checks do not run a model, and an account-limit failure does not disable task linking.

The inspector can send a saved task link to the registered desktop app through **Open in Codex**. It rechecks the current branch association before dispatch, reports missing or failed desktop handlers, and does not send a prompt or request a model turn. A successful handoff means macOS accepted the link; it does not confirm that the destination task loaded. See [task links and verification limits](TASK_LINKS.md).

Disconnect stops inspection and clears OpenBranches' task cache and in-memory account status; it does not sign the user out of Codex or change their conversations. Complete task-destination verification, accessible task summaries, AI execution, scheduling, explicit diff consent, and verification of the full model boundary remain release work. The budget and evidence-preparation modules are implemented but not connected to a model runner. See [advisor implementation](ADVISOR.md) and the roadmap.

Protocol reference: [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Claude Code

Connect **Claude Code sessions** in Settings to read local saved metadata associated with monitored branches. This connection is separate from Codex, does not require an API key, and does not run a model or upload data. It starts disabled and refreshes every minute when enabled. Disconnect clears OpenBranches' Claude cache; original Claude session files remain untouched.

Only explicit custom titles, selected folder/branch metadata, timestamps, session IDs, and reported model IDs are retained. Transcript bytes are read in bounded chunks; prompts and tool output are discarded. Current activity, ownership, and model provider are not inferred. Claude folder/branch matches are possible associations because this source does not provide a saved commit. Settings labels partial history and the last checked time.

The current reader supports the observed local main-session JSONL layout and an absolute inherited `CLAUDE_CONFIG_DIR`. It does not claim all Claude Desktop, Cowork, remote, subagent, or historical file formats. See [source documentation, bounds, tests, and limitations](AGENT_ATTRIBUTION.md). Cursor/Grok examples demonstrate the common UI; their live adapters remain unfinished.

## Apple release signing

Normal `npm run make` is local and unsigned. It forces signing/notarization off, even if Apple credentials are present in the environment.

The separate `npm run make:release` command uploads the packaged artifact to Apple's notarization service. It is for authorized release work only and requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and an installed Developer ID signing identity. Credentials must come from the maintainer's secure environment or CI secret store, never source control.

Public downloads must not be advertised as ready until both architectures are built, signature/notarization verification passes, and installation has been checked on supported Macs.
