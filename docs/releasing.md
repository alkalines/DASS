# Releases and update notices

Discord Alternative ScreenShare (DASS) releases are ordinary builds of manually
selected source revisions. There are no AI jobs, scheduled merges, scheduled
builds, automatic dependency updates, deployments or client auto-installation.
The workflow is `.github/workflows/release.yml` in this same repository.

## Publishing

Push a versioned branch after committing and testing the intended source:

| Branch | Git tag | Contents |
| --- | --- | --- |
| `release/0.1.0` | `v0.1.0` | Custom Equicord ZIP and backend image |
| `release/backend/0.1.1` | `backend-v0.1.1` | Backend image only |

These are **stable GitHub Releases**, not prereleases. Stable is a distribution
channel, not a production-readiness claim. The project remains experimental.
Creating a branch locally does nothing; pushing it triggers the workflow.
Subsequent pushes to an already released version fail rather than move its tag.
Use a new version for the next release, including backend-only releases. Versions
must increase numerically across both release types. Prerelease suffixes are not
supported by this workflow.

Alternatively, run **Actions → Release → Run workflow**, select the intended
source branch, and supply `version` and `component` (`all` or `backend`). A manual
run also publishes a stable release and creates its tag. Keep write access to
release branches and workflow dispatch restricted to trusted maintainers.

The workflow:

1. Validates the version and rejects existing tags or older/equal release versions.
2. For full releases, runs Bun plugin/release/admin tests, the pinned custom
   Equicord build, plugin lint and full host typecheck.
3. Builds the existing Dockerfile, including Docker-only Rust formatting,
   warnings-denied Clippy, locked workspace tests and locked release compilation.
4. Pushes `ghcr.io/alkalines/dass:VERSION` and
   `ghcr.io/alkalines/dass:VERSION-pterodactyl` with OCI source/revision/version
   labels, BuildKit provenance and an SBOM. Initial image support is
   **linux/amd64 only**. Both full and backend-only releases include both images.
5. Creates the Git tag at the exact workflow commit and publishes release assets.
6. Advances standard image aliases `stable` and `latest`, and the Wings image alias
   `pterodactyl`, after GitHub publication succeeds.

All steps run in one workflow: a tag created using `GITHUB_TOKEN` does not need to
trigger another workflow. A failed build does not publish a GitHub Release. An
image push can precede a later publication failure; do not treat an unreferenced
image as a published release. If alias promotion fails after release creation,
use the published version/digest and repair aliases manually; do not move the tag.

The workflow uses GitHub's `GITHUB_TOKEN` with `contents: write` and
`packages: write` only in the publishing job. No registry password or PAT is
needed. Repository/organization policy must permit these permissions and GHCR
package creation. After the first push, make the GHCR package public if anonymous
pulls are intended; public source alone does not guarantee public package access.
Protect release tags against modification/deletion, review workflow changes and
third-party action updates, and retain the corresponding GPL source and notices.

Release assets include:

- Full releases: `dass-equicord-VERSION.zip` and `SHA256SUMS`.
- Every release: `backend-image.json`, containing the image name, immutable digest,
  source commit, version and platform.
- Every release: `pterodactyl-image.json`, containing the Pterodactyl image's name,
  versioned tag, immutable digest, source commit, version, platform and build target.

The `stable` and `latest` aliases refer only to the standard runtime image.
The `pterodactyl` alias tracks the same digest as the newest published
`VERSION-pterodactyl` tag; use the versioned tag or digest for exact pins. See
[Pterodactyl setup](pterodactyl.md).

The ZIP includes the Equicord GPL license and a corresponding-source pointer to
the exact release commit; initialize its pinned submodules to reproduce the build.
The ZIP is the **complete custom Equicord `dist`**, containing desktop and Equibop
targets. It is not a loose plugin or a patched Equibop executable. It does not
include a turnkey Discord installer. Checksums detect corruption; they are not
an independent signature or a verified automatic-update mechanism. The updater
only opens the project's fixed HTTPS release page and never executes downloads.

## Installing a downloaded client bundle

Extract the ZIP to a stable directory you control. Preserve the complete folder
structure. Fully quit the client before replacing an installed bundle.

- **Equibop:** select the extracted `dist` directory as the custom Equicord
  location, not `dist/equibop`; restart and enable DASS. Current source includes
  a plugin-owned stock Equibop capture adapter, described in
  [capture-bridge.md](capture-bridge.md). No modified Equibop application is needed.
  Older bundles may still require the former host bridge. Real-client acceptance
  of the plugin-only adapter remains pending.
- **Discord Desktop:** install/inject the custom desktop build through Equicord's
  installer mechanism. The pinned source wrapper passes `EQUICORD_DIRECTORY`
  pointing to `dist/desktop`, `EQUICORD_USER_DATA_DIR` pointing to the build root,
  and `EQUICORD_DEV_INSTALL=1` to Equilotl's `--install` operation. See
  [plugin.md](plugin.md) for the existing source-install procedure. A portable
  prebuilt installation wrapper still needs platform testing; do not copy files
  blindly into Discord's application directory. Desktop publishing has no
  equivalent supported capture adapter yet.

Both viewers and broadcasters need compatible DASS clients. Neither successful
packaging nor a version match establishes GUI/media compatibility. Ordinary
Discord updates remain independent and can break private hooks. Upstream client
revisions are incorporated deliberately; this workflow does not update their pins.

## Update notifications

Release versions are embedded at build time. Workflow builds set
`DASS_RELEASE_VERSION` for the plugin build and as a Docker build argument for the
backend. Ordinary unversioned local builds identify as `0.1.0-dev` and do not
perform stable update checks; protocol versions are unchanged. For a manually
versioned local build, from the repository root:

```sh
DASS_RELEASE_VERSION=0.1.0 bun scripts/build-plugin.mjs
docker build --build-arg DASS_RELEASE_VERSION=0.1.0 --target runtime -t dass-backend:0.1.0 .
```

- **Plugin:** checks once when its runtime starts, if **Check updates** is enabled.
  A newer full release with an uploaded matching ZIP displays **DASS update
  available** with a clickable manual download link. It does not repeat the same
  version's notice within one loaded client session. Disabling/logging out stops
  pending checks. Equicord's upstream updater remains disabled in custom builds.
- **Backend:** the authenticated admin panel checks when opened and shows the
  same kind of link for newer backend releases, including full releases. This is
  an admin-panel notice, not a plugin popup for every connected viewer. Headless
  servers without an open panel do not check GitHub. The version endpoint is
  authenticated and reports the compiled version, never an environment override
  supplied to an already built container.

Checks read the newest 100 public GitHub Releases, ignore drafts/prereleases and
compare semantic version numbers, not timestamps or lexicographic strings. A
backend-only release does not hide an eligible full plugin release. If the last
100 releases contain no eligible component, no notice is shown. GitHub rate
limits, errors, malformed/oversized responses and offline operation are quiet
and cannot block capture or administration. Checks time out after 10 seconds and
bound GitHub responses to 2 MiB. No polling timer runs in the background.

The plugin makes its request in the existing Electron main process; the admin
browser contacts `api.github.com` directly. These unauthenticated public requests
send no DASS/Discord credentials, backend URL, room identifiers or media. GitHub
still observes the requester's IP. Admin browser requests omit credentials and
referrers; CSP permits only self and the exact GitHub API origin for connections.
Download links are reconstructed from validated tags, not remote-provided URLs.

## Updating the backend

Updates are manual. Back up the SQLite volume before changing versions, review
release notes, and retain all runtime hardening, TLS, port and resource settings.
The published image does not configure hosting or grant public-deployment safety.

For an existing installation, use a local Compose override that changes only the
backend image (example version; substitute an actually published version):

```yaml
# compose.image.yaml, alongside the repository's compose.yaml
services:
  backend:
    image: ghcr.io/alkalines/dass:0.1.0
```

From the repository root:

```sh
docker compose -f compose.yaml -f compose.image.yaml pull backend
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build backend
```

Prefer the immutable `image@sha256:...` from `backend-image.json` for exact pins.
Restore the previous image pin to roll back code, but database/schema downgrade
safety is not guaranteed; use a compatible backup when required. Never remove the
database volume as part of an update. No action here deploys to a running server.

## Validation status

Local Bun validation passed 326 tests across plugin, admin and release suites.
The versioned plugin build passed lint, full Equicord typecheck and both desktop
and Equibop bundle builds with Bun 1.4.3. Workflow YAML and pinned-action checks passed.
The hosted workflow, GHCR permissions, first publication, real notifications,
download installation and Rust changes still require runtime/CI acceptance.
Docker validation was blocked locally by Docker socket access; no host Cargo was used.
