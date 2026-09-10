# Mac release process

OpenBranches has one release path for both supported Mac architectures. It produces a signed, notarized DMG and a SHA-256 checksum on a native Apple silicon or Intel runner. The workflow leaves every GitHub release as a draft so a maintainer can install and review both artifacts before making them public.

## One-time repository setup

Create the public GitHub App used for device authorization and set its client ID as the repository variable `GITHUB_APP_CLIENT_ID`. The desktop bundle never contains a GitHub client secret.

Add these GitHub Actions secrets:

- `MACOS_CERTIFICATE`: the Developer ID Application certificate exported as a password-protected PKCS #12 file and then base64 encoded.
- `MACOS_CERTIFICATE_PASSWORD`: the export password for that certificate.
- `APPLE_ID`: the Apple account used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: an app-specific password for that account.
- `APPLE_TEAM_ID`: the Apple Developer team ID.

The workflow imports the certificate into a temporary keychain and deletes both the keychain and certificate file even after a failed build. Apple credentials are supplied only to the release process. GitHub-hosted `macos-15` and `macos-15-intel` runners provide native arm64 and x64 builds respectively; see [GitHub's hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Build a reviewable release

1. Update `package.json` to the release version and merge the tested release commit.
2. Create a tag with the exact form `v<package version>`, such as `v0.1.0`, and push it.
3. The **Mac release** workflow checks that the tag and package version match, creates a draft GitHub release, and builds both architectures.
4. Each runner runs the desktop tests, checks the generated dependency notices, signs the application, notarizes the application and DMG, verifies the executable architecture, validates both notarization tickets, verifies the disk image and its mounted bundle structure, confirms the app and third-party legal files, and checks its generated SHA-256 file.
5. Download both workflow artifacts. Install each on a clean matching Mac, verify first-run Git setup and project discovery, and confirm GitHub device authorization with the registered app.
6. Review the generated release notes and the two artifacts in the draft release. Publish the draft only after the clean-machine checks pass.

The workflow never publishes a release. A failed architecture leaves the release as a draft and preserves successful artifacts for diagnosis. Re-running the tag workflow updates only that draft; it refuses to alter an already published release.

The mounted-bundle check rejects absolute framework symlinks. This protects against a subtle class of DMGs that pass a filesystem checksum but fail after leaving the build folder because Electron resources still point back to that folder.

The public files are named for people rather than build internals:

- `OpenBranches-<version>-mac-arm64.dmg` for Apple silicon Macs.
- `OpenBranches-<version>-mac-x64.dmg` for Intel Macs.
- A matching `.sha256` file for each installer.

## Local packaging

On macOS, `npm run make` creates an unsigned developer preview for the current architecture. `npm run make:arm64` and `npm run make:x64` select an architecture explicitly. Preview names include `-unsigned` so they cannot be mistaken for a public release.

Run the corresponding integrity check after packaging:

```sh
npm run verify:macos -- --arch=arm64
```

`npm run make:release -- --arch=arm64` uses the same pipeline with signing and notarization enabled. It requires the Apple environment variables, an installed Developer ID identity, and `GITHUB_APP_CLIENT_ID`. Use it only from a controlled release environment. Packaging never uploads an artifact by itself.

## License resources

`npm run notices:generate` walks the production dependency graph in `package-lock.json` and records the exact installed license texts in `THIRD_PARTY_NOTICES.md`. `npm test` checks that this generated file is current. The one package that omits its license file from the npm archive has a version-specific copy from its matching source tag under `legal/overrides/`.

Every production build copies the OpenBranches license, the generated third-party notices, and Electron’s complete Chromium/Node notice collection into the app resources. Privacy settings opens a disposable copy so viewing a notice cannot alter the signed application. Both the DMG builder and the independent mounted-image verifier reject an app with missing or truncated legal resources.
