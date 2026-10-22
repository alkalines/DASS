# On-demand Docker images

Discord Alternative ScreenShare (DASS) can build its standard Docker runtime and
Pterodactyl/Wings image without creating a release or changing release aliases.

## Run the workflow

After `.github/workflows/images.yml` is on the default branch:

1. Open **Actions → Build Docker images → Run workflow**.
2. Select the source branch or tag to build.
3. Choose `both`, `runtime` (normal Docker), or `pterodactyl`.
4. Leave **publish** unchecked for downloadable images, or check it to push to GHCR.

The workflow uses the existing Dockerfile on GitHub's hosted runner. Each target
checks formatting, Clippy with warnings denied, locked Rust tests and the locked
release build inside Docker. Images are **linux/amd64 only**. No plugin bundle,
Git tag, GitHub Release, deployment or client installation is created.

## Download without publishing (default)

Download the selected image's artifact from the completed workflow run and extract
the ZIP. Artifacts expire after seven days. Load the tar from that directory:

```sh
docker load --input dass-runtime.tar
# Or, for Wings:
docker load --input dass-pterodactyl.tar
```

The run summary lists the loaded image's exact tag and source commit. Docker tar
exports do not contain registry SBOM/provenance attestations. Loading an image
does not start it; use [the backend guide](backend.md) for runtime configuration
or [the Wings guide](pterodactyl.md) for node-local image selection and prerequisites.

## Publish to GHCR

Publishing uses `GITHUB_TOKEN`; no separate registry password is needed. Repository
policy must allow `packages: write`, and an existing GHCR package must grant this
repository Actions access. Make the package public separately if anonymous pulls
are intended. Only trusted maintainers should dispatch publishing builds.

For repository `OWNER/REPO`, tags use the lowercased repository path:

| Image | Tag |
| --- | --- |
| Normal Docker | `ghcr.io/owner/repo:manual-RUN_ID-ATTEMPT` |
| Pterodactyl | `ghcr.io/owner/repo:manual-RUN_ID-ATTEMPT-pterodactyl` |

Every run attempt gets new tags; there is no user-supplied release tag to overwrite.
The summary includes the pull command and published digest. Published images have
SBOM and maximum-level provenance attestations. The release aliases `latest`,
`stable` and `pterodactyl`, and all versioned release tags, remain untouched.
Manual builds embed `0.0.0-manual.RUN_ID.ATTEMPT`, not a stable release version.
When building both, targets run independently: one can succeed even if the other
fails. Check both job results before using them.

Workflow execution, registry publication and real Wings deployment still require
CI/runtime acceptance. Build success is not media interoperability or production
readiness evidence; existing TLS, resource-limit and experimental-use restrictions
remain unchanged.
