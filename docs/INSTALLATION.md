# Mac installation and first-run setup

OpenBranches v0.1.0 is available as a signed, notarized DMG for Apple silicon and Intel Macs. Choose the installer that matches your Mac; no Apple Developer account or source-code build is required.

## Install the public release

1. Download [Apple silicon (`arm64`)](https://github.com/Charlesmendez/OpenBranches/releases/download/v0.1.0/OpenBranches-0.1.0-mac-arm64.dmg) for M1 and newer Apple-chip Macs, or [Intel (`x64`)](https://github.com/Charlesmendez/OpenBranches/releases/download/v0.1.0/OpenBranches-0.1.0-mac-x64.dmg) for an Intel Mac. The [latest release page](https://github.com/Charlesmendez/OpenBranches/releases/latest) includes both downloads and their checksums.
2. Drag OpenBranches into Applications and open it.
3. Choose a local project folder. No account is required for local Git inspection.
4. Optionally connect GitHub or existing Codex task history in Settings.

End users do not need Node.js, npm, Xcode, an Apple Developer account, or a source-code build. Contributors use the development commands in the README.

The downloads are signed with the project's Developer ID and notarized by Apple, so first launch uses the normal macOS identified-developer flow. The project does not need to be listed in the Mac App Store. Unsigned local DMGs are intentionally labeled `-unsigned` and are for development.

## Git setup in the app

OpenBranches uses Git to read branch history and worktrees. It checks common Homebrew locations and Apple’s selected developer tools, so a Finder launch does not depend on terminal PATH configuration. The detected absolute executable is used by the scanner. Inherited `GIT_*` repository and configuration overrides are cleared before inspection.

Git 2.36 or newer is required. That version introduced the NUL-delimited worktree output used to preserve paths containing unusual characters; see [Git’s release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.36.0.adoc).

When Git is missing, the app explains the prerequisite and offers **Install Apple’s tools**. This button requests the standard macOS Command Line Tools installer. macOS handles the download, consent, and installation. OpenBranches does not install anything during automatic detection. It avoids invoking Apple’s Git shim until the selected developer tools are present, because that shim can otherwise open the installer unexpectedly.

Keep OpenBranches open and finish the steps in Apple’s window. It rechecks while visible and when you return to it. **Check again** is available at any time; **Open installer again** handles a canceled dialog. The demo remains available during setup.

Keyboard users can reach **Skip to workspace** as the first app control. It moves focus past the title bar and project navigation to the current page. Choosing a page or project in the sidebar also moves focus to the newly named workspace, so assistive technology announces the destination instead of leaving focus on a control that changed the page. The first-run Git screen exposes one page heading, identifies its setup region, reports busy installation checks, and announces installer progress and failures.

An unsupported or broken Git installation shows repair guidance instead of pretending local tracking is working. Saved repositories remain visible while inspection is paused. The help button opens [Apple’s official setup guide](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools); it cannot open an arbitrary link supplied by repository content.

## Verification status

- Automated tests cover missing Apple tools, a shim reached through a symlink, Homebrew outside the launch PATH, supported and old Apple Git, failed probes, inherited Git overrides, coalesced checks, explicit installer requests, failed requests, and recovery. Opening an installer never counts as a completed installation.
- A real Git fixture confirms that scanning with a limited PATH and another repository’s inherited Git settings still inspects the selected folder and preserves its index.
- The desktop build has detected Git and scanned the selected repository on the development Mac. The missing-tool, retry, demo, recovery, and old-version screens have been exercised through the browser fixture. Its accessibility tree was also checked for the named main landmark, single first-run heading, setup region, status message, and focus after skip, sidebar, and demo transitions. The rebuilt packaged app independently exposed the named workspace and kept focus on it after skip and sidebar navigation. A manual VoiceOver walkthrough remains a release check.
- The v0.1.0 release was built on native Apple silicon and Intel GitHub runners. Each job checked the executable architecture, code signature, stapled notarization tickets, mounted bundle, legal resources, DMG integrity, and SHA-256 checksum before attaching the installer to the release.
- The signed Apple silicon and Intel installers are public. Broader clean-machine runtime checks, supported macOS-version coverage, and a manual VoiceOver walkthrough remain follow-up validation work.
- The [Mac release workflow](RELEASING.md) creates a reviewable draft for each version tag. A maintainer publishes it only after every native build and verification job passes.

For UI verification, run `npm run dev:web` and open `/tests/ui/setup.html`. Its clearly labeled controls simulate the environment. All desktop operations are mocked, and the fixture is excluded from the production entry points.
