# COMAC Private Update Feed Design

## Background

The COMAC private deployment of Sudowork needs an update flow that does not depend on the public COS release bucket. Builds are produced by the existing custom-server workflow, delivered to the customer, and then deployed by the customer to an internal static file server.

The expected customer update server shape is:

```text
http://10.0.1.79:8080/downloads
```

The client should check update metadata from that directory, compare versions, download the matching installer, verify integrity, and support both automatic install and manual download fallback.

## Decisions

- Create an independent project branch from commit `1ed9555`.
- Suggested branch name: `codex/comac-private-update-feed`.
- The branch is for the COMAC private deployment only.
- Public COS fallback is disabled in this branch.
- The private branch maintains its own app version in `package.json`.
- Initial private version is `1.0.0`.
- Version numbers use normal three-part semver: `1.0.0`, `1.0.1`, `1.0.2`.
- Supported platforms are Windows x64 and macOS arm64.
- The workflow produces a real `private-update-assets.zip`.
- The zip root is flat; customers extract it directly into `/downloads`.
- HTTP is supported only for the configured private update feed base URL.

## Non-Goals

- Do not build a generic multi-customer update platform.
- Do not add a new server-side system-config field.
- Do not support Linux in this private update flow.
- Do not support Windows arm64 or macOS x64 in the first version.
- Do not upload artifacts directly to the customer server from GitHub Actions.
- Do not fall back to the public Sudowork COS release bucket.
- Do not introduce a custom update metadata protocol if the existing electron-updater format can be reused.

## Update Feed Configuration

The private branch reuses the existing server config field:

```json
{
  "version_update": {
    "enabled": 1,
    "cos_domain": "http://10.0.1.79:8080/downloads"
  }
}
```

In the COMAC private branch, `version_update.cos_domain` is interpreted as the complete update feed base URL, not only as a COS domain.

The value must include a protocol:

```text
http://10.0.1.79:8080/downloads
https://example.internal/downloads
```

The client accepts values with or without a trailing slash and normalizes the base URL by removing trailing slashes.

Configuration priority:

```text
server version_update.cos_domain
> workflow-injected private update base URL
> error: private update feed is not configured
```

If `version_update.enabled = 0`, update checks remain disabled. Manual checks should show:

```text
版本更新已被服务端禁用
```

If no private update feed is configured, manual checks should show:

```text
私有更新源未配置
```

## Runtime Update Flow

The current public release flow reads metadata from COS paths such as:

```text
<cos-base>/sudowork/release/latest/latest.yml
<cos-base>/sudowork/release/latest/arm64-mac.yml
```

The COMAC private branch should instead read directly from the configured feed base:

```text
http://10.0.1.79:8080/downloads/latest.yml
http://10.0.1.79:8080/downloads/arm64-mac.yml
```

Platform metadata selection:

```text
Windows x64  -> latest.yml
macOS arm64  -> arm64-mac.yml
```

The metadata format remains compatible with electron-updater.

Windows x64 example:

```yaml
version: 1.0.1
files:
  - url: Sudowork-1.0.1-win-x64.exe
    sha512: <sha512>
    size: <size>
path: Sudowork-1.0.1-win-x64.exe
sha512: <sha512>
releaseDate: '2026-09-01T00:00:00.000Z'
```

macOS arm64 example:

```yaml
version: 1.0.1
files:
  - url: Sudowork-1.0.1-mac-arm64.zip
    sha512: <zip-sha512>
    size: <zip-size>
  - url: Sudowork-1.0.1-mac-arm64.dmg
    sha512: <dmg-sha512>
    size: <dmg-size>
path: Sudowork-1.0.1-mac-arm64.zip
sha512: <zip-sha512>
releaseDate: '2026-09-01T00:00:00.000Z'
```

Version comparison uses semver:

```text
remote yml version > app.getVersion()
```

This is why `package.json.version` must be changed on the private branch. Changing only build display metadata is not enough.

## Download Behavior

The UI keeps both update options:

- Download and install.
- Download only.

Windows x64:

- Automatic install downloads the yml `path`, normally `Sudowork-<version>-win-x64.exe`.
- Manual download also selects the Windows installer, normally `.exe`.
- The matching `.exe.blockmap` may be requested by electron-updater for differential download.

macOS arm64:

- Automatic install downloads the yml `path`, normally `Sudowork-<version>-mac-arm64.zip`.
- Manual download prefers the `.dmg` fallback because the current asset scoring prefers `.dmg` over `.zip` on macOS.
- The matching `.zip.blockmap` may be requested by electron-updater for differential download.

## HTTP Safety Rules

The private branch supports HTTP only for the configured update feed base URL. This avoids turning the update downloader into an arbitrary HTTP file downloader.

For a configured base:

```text
http://10.0.1.79:8080/downloads
```

Allowed:

```text
http://10.0.1.79:8080/downloads/latest.yml
http://10.0.1.79:8080/downloads/Sudowork-1.0.1-win-x64.exe
```

Rejected:

```text
http://10.0.1.79:8080/other.exe
http://10.0.1.80:8080/downloads/file.exe
```

The check should compare both:

- Same `origin`.
- Download path starts with the configured feed base pathname.

HTTPS public hosts are not needed for this private branch unless the configured private feed uses HTTPS.

## Workflow Design

The private branch updates `.github/workflows/build-custom-server.yml` so it builds only:

```text
windows-x64
macos-arm64
```

The workflow should accept or use:

```text
server_base_url
private_update_base_url
```

The branch itself sets:

```json
"version": "1.0.0"
```

Future private releases update `package.json.version` on the branch before building.

The workflow should add a packaging job after the reusable build pipeline:

1. Download build artifacts.
2. Normalize release metadata into a staging directory.
3. Keep only Windows x64 and macOS arm64 files.
4. Generate latest aliases.
5. Create `private-update-assets.zip` with a flat root.
6. Upload `private-update-assets.zip` as a GitHub Actions artifact.

Expected zip contents:

```text
latest.yml
arm64-mac.yml
Sudowork-1.0.0-win-x64.exe
Sudowork-1.0.0-win-x64.exe.blockmap
Sudowork-latest-win-x64.exe
Sudowork-latest-win-x64.exe.blockmap
Sudowork-1.0.0-mac-arm64.zip
Sudowork-1.0.0-mac-arm64.zip.blockmap
Sudowork-latest-mac-arm64.zip
Sudowork-latest-mac-arm64.zip.blockmap
Sudowork-1.0.0-mac-arm64.dmg
Sudowork-latest-mac-arm64.dmg
```

The customer deploys by extracting the zip contents directly into:

```text
http://10.0.1.79:8080/downloads
```

The deployed directory must be flat:

```text
/downloads/latest.yml
/downloads/arm64-mac.yml
/downloads/Sudowork-1.0.0-win-x64.exe
/downloads/Sudowork-1.0.0-win-x64.exe.blockmap
/downloads/Sudowork-1.0.0-mac-arm64.zip
/downloads/Sudowork-1.0.0-mac-arm64.zip.blockmap
/downloads/Sudowork-1.0.0-mac-arm64.dmg
```

## Implementation Areas

Expected code areas:

- `package.json`
- `.github/workflows/build-custom-server.yml`
- `src/common/systemConfig.ts`
- `src/process/services/autoUpdaterService.ts`
- `src/process/bridge/updateBridge.ts`
- `src/renderer/i18n/locales/*/update.json`

The implementation should replace hardcoded COS update feed usage in this branch with a private update feed helper. The helper should:

- Read `version_update.cos_domain`.
- Normalize trailing slashes.
- Fall back to the build-injected private update URL.
- Return an explicit error when unset.
- Preserve `version_update.enabled` handling.
- Validate HTTP downloads against the configured feed base.

## Test Plan

Recommended verification:

```bash
bunx eslint src/common/systemConfig.ts --fix
bunx eslint src/process/services/autoUpdaterService.ts --fix
bunx eslint src/process/bridge/updateBridge.ts --fix
bunx tsc --noEmit
```

Workflow validation:

- Trigger `build-custom-server.yml`.
- Confirm only Windows x64 and macOS arm64 builds run.
- Download `private-update-assets.zip`.
- Confirm the zip root is flat.
- Confirm `latest.yml` references `Sudowork-1.0.0-win-x64.exe`.
- Confirm `arm64-mac.yml` references `Sudowork-1.0.0-mac-arm64.zip` as `path`.
- Confirm `.blockmap` files exist for Windows `.exe` and macOS `.zip`.

Runtime validation:

- Serve the extracted zip at `http://10.0.1.79:8080/downloads`.
- Configure server `version_update.cos_domain` to that full URL.
- Confirm Windows x64 reads `/downloads/latest.yml`.
- Confirm macOS arm64 reads `/downloads/arm64-mac.yml`.
- Confirm `version_update.enabled = 0` disables checks.
- Confirm missing feed config shows `私有更新源未配置`.
- Confirm HTTP downloads outside the configured base URL are rejected.

## Risks And Notes

- Reusing `cos_domain` for a complete feed URL is a private-branch semantic change. It should not be merged back into the public `dev` branch.
- Private versions must remain valid semver. Four-part versions such as `1.0.0.1` should not be used.
- If `package.json.version` is not bumped for each private release, clients will not detect an update.
- If customers extract the zip into a nested directory such as `/downloads/private-update-assets`, update checks will fail.
- If the customer server blocks range requests, electron-updater may fall back from differential download to full download. Full download should still work if the files are accessible and checksums match.
- If code signing or installer permissions fail on customer machines, automatic install may fail; the manual download button remains the operational fallback.
