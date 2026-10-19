# Agent desktop candidate signing

`Agent Desktop Candidate` (`.github/workflows/agent-candidate.yml`) is a manual
macOS ARM64 build that reuses the existing `_build-reusable.yml` pipeline. It
checks out the triggering full commit, runs code quality checks, builds with
`--publish=never`, and uploads short-lived Actions artifacts. It does not create
GitHub releases, upload to COS, or advance an update channel.

The workflow uses the existing repository Secrets: `BUILD_CERTIFICATE_BASE64`,
`P12_PASSWORD`, `IDENTITY`, `TEAM_ID`, `APPLE_ID`, and `APPLE_ID_PASSWORD`.
`KEYCHAIN_PASSWORD` remains optional under the existing reusable workflow.
No local certificate installation or credential export is required. Candidate
builds fail early when required signing configuration is missing.

The regular release pipeline has historically allowed notarization warnings.
The candidate caller enables `strict_macos_candidate`, adding a separate gate
before artifact upload. `scripts/verify_macos_candidate.py` checks the actual
application inside both the read-only mounted DMG and the extracted update ZIP:

- Expected bundle identifier, architecture, Developer ID team and hardened runtime.
- Deep, strict code signature verification; ad-hoc signatures cannot qualify.
- A valid stapled Apple notarization ticket and Gatekeeper assessment.
- Identical application code directory hash, version and build in both formats.

Only after all checks pass does `macos-candidate.json` record the full source
commit, application identity, checks and SHA256 of each distribution. A failed
rerun removes the previous receipt. Missing/duplicate packages, signing errors,
notarization failures or differing DMG/ZIP applications block upload.

After the reviewed branch is available on GitHub, run this workflow against that
branch and confirm the displayed full commit. Download the receipt and both
artifacts from the same run, verify their SHA256, and retain the Actions run URL
with the candidate evidence. An unexecuted workflow is not signing evidence.

This gate proves signing and notarization for the recorded packages. Installing
the downloaded DMG on a clean macOS profile, first launch, login, agent selection
and actual provider conversation remain separate acceptance steps. ARM64 success
does not qualify x64 or Windows builds.

Local verifier regression tests (no certificates required):

```sh
python3 -m unittest discover -s scripts -p test_verify_macos_candidate.py
```
