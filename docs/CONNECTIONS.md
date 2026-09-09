# Connection setup

## GitHub

Public GitHub reading is available in Settings without sign-in. It only reads remotes of repositories you selected; GitHub's unauthenticated rate limits apply. Private repositories require GitHub App authorization.

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

Currently detected but not connected. The planned integration uses the installed Codex app-server and existing sign-in, not a bundled API key. Task discovery, AI recommendations, explicit diff consent, strict tool restrictions, and usage limits remain release work. See the roadmap.

## Apple release signing

Normal `npm run make` is local and unsigned. It forces signing/notarization off, even if Apple credentials are present in the environment.

The separate `npm run make:release` command uploads the packaged artifact to Apple's notarization service. It is for authorized release work only and requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and an installed Developer ID signing identity. Credentials must come from the maintainer's secure environment or CI secret store, never source control.

Public downloads must not be advertised as ready until both architectures are built, signature/notarization verification passes, and installation has been checked on supported Macs.
