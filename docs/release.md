# Release Checklist

This document covers the unified release workflow for stable and nightly desktop releases.

## What the workflow does

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - push tag matching `v*.*.*` for stable releases
  - scheduled nightly at `09:00 UTC`
  - manual `workflow_dispatch` for either channel
- Runs quality gates first: lint, typecheck, test.
- Builds four artifacts in parallel for both channels:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- Publishes one GitHub Release with all produced files.
  - Stable tags with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain stable `X.Y.Z` releases are marked as the repository's latest release.
  - Nightly runs are always GitHub prereleases and never marked latest.
  - Automatically generated release notes are pinned to the previous tag in the same channel, so stable compares to the previous stable tag and nightly compares to the previous nightly tag.
- Includes Electron auto-update metadata (for example `latest*.yml`, `nightly*.yml`, and `*.blockmap`) in release assets.
- Optionally publishes the CLI package (`apps/server`) only when repository variable `ENABLE_CLI_PUBLISH` is set to `true`.
- Optionally runs the post-release version bump/finalize flow only when repository variable `ENABLE_RELEASE_FINALIZE` is set to `true`.
- Signing is optional and auto-detected per platform from secrets.

## Recommended current setup for this fork

If your current goal is "desktop GitHub Releases first, everything else later", keep the workflow in this mode:

- Repository variables:
  - `ENABLE_CLI_PUBLISH=false`
  - `ENABLE_RELEASE_FINALIZE=false`
- No npm publishing setup required.
- No GitHub App finalize setup required.
- Apple and Windows signing can be added later.

With that setup, pushed release tags still build the desktop artifacts and publish a GitHub Release, which is enough for manual downloads and app auto-update checks.

## Nightly builds

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - scheduled every day at `09:00 UTC`
  - manual `workflow_dispatch` with `channel=nightly`
- Runs the same desktop quality gates and artifact matrix as the tagged release flow.
- Publishes a GitHub prerelease only:
  - tag format: `nightly-vX.Y.Z-nightly.YYYYMMDD.<run_number>`
  - release name includes the short commit SHA
  - `make_latest` is always `false`
- Uses the next stable patch version as the nightly base. For example, `0.0.17` produces nightlies on `0.0.18-nightly.*`.
- Publishes Electron auto-update metadata to the dedicated `nightly` updater channel, so desktop users can opt into that track independently from stable.
- Publishes the CLI package only if `ENABLE_CLI_PUBLISH=true`.
- Does not commit version bumps back to `main`.

## Desktop auto-update notes

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`.
- Update UX:
  - Background checks run on startup delay + interval.
  - No automatic download or install.
  - The desktop UI shows a rocket update button when an update is available; click once to download, click again after download to restart/install.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- Repository slug source:
  - `T3CODE_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set.
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions.
- Temporary private-repo auth workaround:
  - set `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN` (or `GH_TOKEN`) in the desktop app runtime environment.
  - the app forwards it as an `Authorization: Bearer <token>` request header for updater HTTP calls.
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - channel metadata: `latest*.yml` for stable releases, `nightly*.yml` for nightly releases
  - `*.blockmap` files (used for differential downloads)
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` on stable and `nightly-mac.yml` on nightly, for both Intel and Apple Silicon.
  - The workflow merges the per-arch mac manifests into one channel-specific mac manifest before publishing the GitHub Release.

## 0) First release on this fork

Use this path first if you want downloadable releases for yourself and friends without taking on npm publishing or post-release automation yet.

Checklist:

1. In GitHub repository settings, add Actions variables:
   - `ENABLE_CLI_PUBLISH=false`
   - `ENABLE_RELEASE_FINALIZE=false`
2. Confirm the repo is public if you want the simplest GitHub Releases download/update path.
3. Decide whether this first release will be unsigned:
   - unsigned is acceptable for initial testing and friend distribution
   - signed/notarized is strongly recommended later for normal macOS installs and macOS auto-update
4. Push a stable tag like `v0.1.0`.
5. Wait for `.github/workflows/release.yml` to finish.
6. Verify the GitHub Release contains all expected assets.

## 1) Dry-run release without signing

Use this first to validate the release pipeline.

1. Confirm no signing secrets are required for this test.
2. Create a test tag:
   - `git tag v0.0.0-test.1`
   - `git push origin v0.0.0-test.1`
3. Wait for `.github/workflows/release.yml` to finish.
4. Verify the GitHub Release contains all platform artifacts.
5. Download each artifact and sanity-check installation on each OS.

## 2) Stable release steps

Typical stable release flow:

1. Ensure `main` is green in CI.
2. Run locally:
   - `bun fmt`
   - `bun lint`
   - `bun typecheck`
3. Push the current branch to `main`.
4. Create release tag: `vX.Y.Z`.
5. Push tag.
6. Verify workflow steps:
   - preflight passes
   - all matrix builds pass
   - release job uploads expected files
7. Smoke test downloaded artifacts.

Example:

```bash
git checkout main
git pull origin main
bun fmt
bun lint
bun typecheck
git push origin main
git tag v0.1.0
git push origin v0.1.0
```

## 3) Apple signing + notarization setup (macOS)

Add this when you want a normal macOS install experience and reliable macOS auto-updates.

The desktop artifact builder enables hardened runtime, Electron entitlements, and electron-builder's notarization integration when `--signed` or `T3CODE_DESKTOP_SIGNED=true` is set. Unsigned builds keep signing discovery disabled.

Required secrets used by the workflow:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create `Developer ID Application` certificate.
3. Export certificate + private key as `.p12` from Keychain.
4. Base64-encode the `.p12` and store as `CSC_LINK`.
5. Store the `.p12` export password as `CSC_KEY_PASSWORD`.
6. In App Store Connect, create an API key (Team key).
7. Add API key values:
   - `APPLE_API_KEY`: contents of the downloaded `.p8`
   - `APPLE_API_KEY_ID`: Key ID
   - `APPLE_API_ISSUER`: Issuer ID
8. Re-run a tag release and confirm macOS artifacts are signed/notarized.

Notes:

- `APPLE_API_KEY` is stored as raw key text in secrets.
- The workflow writes it to a temporary `AuthKey_<id>.p8` file at runtime.
- For a local signed macOS build, keep the `Developer ID Application` certificate in the login keychain and run with:

  ```sh
  CSC_NAME="Launch Forge LLC (624AFNF493)" \
    APPLE_API_KEY="$HOME/Downloads/AuthKey_<KEY_ID>.p8" \
    APPLE_API_KEY_ID="<KEY_ID>" \
    APPLE_API_ISSUER="<ISSUER_ID>" \
    bun run dist:desktop:dmg:arm64 -- --signed
  ```

- Never commit the `.p8` file, `.p12` export, or key contents to the repository.

## 4) Azure Trusted Signing setup (Windows)

Required secrets used by the workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create/choose an Entra app registration (service principal).
4. Grant service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Add Azure secrets listed above in GitHub Actions secrets.
7. Re-run a tag release and confirm Windows installer is signed.

## 5) Optional CLI publish setup

Only do this when you actually want the workflow to publish the CLI package from `apps/server`.

Checklist:

1. Confirm npm org/user owns the target package name.
2. In npm package settings, configure Trusted Publisher:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
3. Ensure npm account and org policies allow trusted publishing for the package.
4. Set repository variable `ENABLE_CLI_PUBLISH=true`.
5. Push a release tag and confirm the `publish_cli` job succeeds.

## 6) Optional finalize setup

Only do this when you want the workflow to commit version bumps back to `main` after stable releases.

Required secrets used by the workflow:

- `RELEASE_APP_ID`
- `RELEASE_APP_PRIVATE_KEY`

Checklist:

1. Create or reuse a GitHub App with permission to commit to this repository.
2. Store the app ID and private key in repository Actions secrets.
3. Set repository variable `ENABLE_RELEASE_FINALIZE=true`.
4. Push a stable release tag and confirm the `finalize` job succeeds.

## 7) Troubleshooting

- macOS build unsigned when expected signed:
  - Check all Apple secrets are populated and non-empty.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- `publish_cli` did not run:
  - Check `ENABLE_CLI_PUBLISH`.
- `finalize` did not run:
  - Check `ENABLE_RELEASE_FINALIZE`.
- Build fails with signing error:
  - Retry with secrets removed to confirm unsigned path still works.
  - Re-check certificate/profile names and tenant/client credentials.
