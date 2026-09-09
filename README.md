# OpenBranches

A local Mac app for understanding branches, worktrees, and the work behind them.

OpenBranches brings local Git and GitHub into one workspace: a grouped branch map, searchable inventory, branch details, recent activity, and evidence-backed recommendations. It is being built for people who have accumulated more coding-agent branches than they can comfortably remember.

**Development preview.** The full first release is still in progress. Codex-powered analysis and signed public downloads are not available yet. See [the roadmap](docs/ROADMAP.md) for the complete scope and outstanding work.

## What works now

- Add local Git repositories through a native folder picker. Shared worktrees are inspected together.
- Browse hundreds of branches in collapsed groups; expand a group into readable pages or search the full inventory with ⌘K.
- See local and remote copies, uncommitted work, integration history, and the evidence behind each result.
- Watch local changes while the app is running; refresh connected GitHub sources every two minutes.
- Read public GitHub branches and pull requests without signing in. Private-repository sign-in is implemented using GitHub App device authorization but requires the release app registration.
- Review deterministic findings about work that may deserve attention.
- Connect local Codex task history, including archived tasks. Inspect the evidence for each branch association; multiple tasks can belong to a branch. This connection reads saved metadata and does not run AI.
- Explore a fictional demo with 403 branch entries, independent of your real repositories.

Repository inspection is read-only. OpenBranches does not fetch into your repositories, push, merge, delete branches, or remove worktrees. An absent commit in a target's ancestry is not presented as proof that a squash-equivalent change is missing.

## Installation

The intended release experience is **download the DMG, drag OpenBranches into Applications, open it, choose your projects**. End users will not need Node.js or a terminal. Git is required for local inspection; guided prerequisite detection remains on the roadmap.

Current installers are **unsigned developer previews**, not normal public releases. Signed and notarized downloads for Apple Silicon and Intel Macs are a release gate. We do not recommend changing macOS security settings to install a preview.

## Develop locally

Use Node.js 24 LTS, npm, Git, and macOS. Then:

```sh
npm ci
npm run dev
```

The browser-only preview uses fictional data:

```sh
npm run dev:web
```

Verify changes:

```sh
npm run typecheck
npm test
npm run format:check
npm audit
```

Build a production renderer and desktop bundle:

```sh
npm run build
```

Create an **unsigned, local-only** app and installer:

```sh
npm run make
```

Artifacts are written under `out/`. This command explicitly disables signing and notarization and does not upload a release. A distinct `make:release` command enables Apple signing/notarization; it requires release credentials and explicit release authorization.

Set `GITHUB_APP_CLIENT_ID` when building to enable GitHub App device sign-in. The client ID is public; no GitHub client secret is bundled. See [connection setup](docs/CONNECTIONS.md).

## Contributing

The integration branch is `develop`. Start one focused branch from the updated integration branch and open a pull request back to it. Keep Git inspection read-only, separate local and remote evidence, and test changes that could misclassify work or expose credentials.

The application is organized by domain, UI, Git inspection, and external providers. See [architecture](docs/ARCHITECTURE.md). The ZIP extraction workspace under `vendor/` is a small CommonJS adapter to Electron's maintained extractor; it replaces an outdated packaging dependency rather than copying an archive parser.

MIT licensed. OpenBranches is an independent project and is not an official OpenAI or GitHub product.
