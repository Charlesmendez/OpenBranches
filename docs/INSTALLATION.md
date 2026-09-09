# Mac installation and first-run setup

OpenBranches is still a development preview. The intended public release is a signed, notarized DMG for Apple Silicon and Intel Macs. Those public downloads and their clean-machine installation checks remain release work; the existing unsigned artifacts are for development.

## Intended public installation

1. Download the release for your Mac.
2. Drag OpenBranches into Applications and open it.
3. Choose a local project folder. No account is required for local Git inspection.
4. Optionally connect GitHub or existing Codex task history in Settings.

End users do not need Node.js, npm, or a source-code build. Contributors currently use the development commands in the README.

## Git setup in the app

OpenBranches uses Git to read branch history and worktrees. It checks common Homebrew locations and Apple’s selected developer tools, so a Finder launch does not depend on terminal PATH configuration. The detected absolute executable is used by the scanner. Inherited `GIT_*` repository and configuration overrides are cleared before inspection.

Git 2.36 or newer is required. That version introduced the NUL-delimited worktree output used to preserve paths containing unusual characters; see [Git’s release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.36.0.adoc).

When Git is missing, the app explains the prerequisite and offers **Install Apple’s tools**. This button requests the standard macOS Command Line Tools installer. macOS handles the download, consent, and installation. OpenBranches does not install anything during automatic detection. It avoids invoking Apple’s Git shim until the selected developer tools are present, because that shim can otherwise open the installer unexpectedly.

Keep OpenBranches open and finish the steps in Apple’s window. It rechecks while visible and when you return to it. **Check again** is available at any time; **Open installer again** handles a canceled dialog. The demo remains available during setup.

An unsupported or broken Git installation shows repair guidance instead of pretending local tracking is working. Saved repositories remain visible while inspection is paused. The help button opens [Apple’s official setup guide](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools); it cannot open an arbitrary link supplied by repository content.

## Verification and remaining release checks

- Automated tests cover missing Apple tools, a shim reached through a symlink, Homebrew outside the launch PATH, supported and old Apple Git, failed probes, inherited Git overrides, coalesced checks, explicit installer requests, failed requests, and recovery. Opening an installer never counts as a completed installation.
- A real Git fixture confirms that scanning with a limited PATH and another repository’s inherited Git settings still inspects the selected folder and preserves its index.
- The desktop build has detected Git and scanned the selected repository on the development Mac. The missing-tool, retry, demo, recovery, and old-version screens have been exercised through the browser fixture.
- A clean Mac/VM test of Apple’s actual installer is still required. No development test downloads or installs Apple’s tools on the developer’s machine. Signed installation, Intel runtime validation, and supported macOS-version coverage remain release gates.

For UI verification, run `npm run dev:web` and open `/tests/ui/setup.html`. Its clearly labeled controls simulate the environment. All desktop operations are mocked, and the fixture is excluded from the production entry points.
