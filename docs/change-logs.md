# Changelog

Notable changes to Discord Alternative ScreenShare (DASS), newest first.
Dates use `YYYY-MM-DD`; commit links identify implementations, not runtime acceptance.
Publication status is recorded by [GitHub Releases](https://github.com/alkalines/DASS/releases), not by an entry's date.
Uncommitted work has no commit ID until it is committed. See [release guidance](releasing.md).

> [!WARNING]
> DASS is experimental. Production use and unrestricted public deployment are
> not recommended. Functional tests are not an independent security audit.

## [1.0.0] - 2026-10-22

### Added

- **Discord Desktop capture:** added a native screen picker for standard Discord
  Desktop, including Windows client support. Thanks to
  [@Gabriel-Hiss](https://github.com/Gabriel-Hiss).
  ([`63308cd`](https://github.com/alkalines/DASS/commit/63308cd))
- **Publisher approvals:** show incoming viewer requests with explicit approve/deny
  actions and optional automatic approval.
  ([`f5d810f`](https://github.com/alkalines/DASS/commit/f5d810f))
- **Pterodactyl image:** added a separate Wings-compatible backend image target.
  This is an image, not an importable Pterodactyl or Pelican egg.
  ([`6499f2c`](https://github.com/alkalines/DASS/commit/6499f2c))

### Fixed

- **Viewer feedback:** explain when publisher approval is pending or has timed out
  instead of leaving viewers without a clear status.
  ([`2e3c58c`](https://github.com/alkalines/DASS/commit/2e3c58c))
- **Plugin builds:** tolerate staged protocol-header line endings during validation.
  ([`1574b97`](https://github.com/alkalines/DASS/commit/1574b97))

### Validation

- **User-reported on 2026-10-22:** E2EE and public hosting were tested and are
  working in the tested setup. Exact source/artifact hashes, client versions,
  network topology and test matrix were not supplied with this report. This is
  functional evidence, not cryptographic review, capacity evidence or a production
  recommendation. Existing [security findings](security-release.md) remain open.

### Pending / not released

- **Simultaneous sharing:** working-tree changes add a bounded two-publisher
  topology with one viewer per publisher, not arbitrary multi-viewer support.
  No commit ID or runtime acceptance is recorded yet; see
  [simultaneous sharing](simultaneous-sharing.md).
- **Pelican egg:** planned hosting integration; no committed egg or validation
  evidence is recorded here yet. Do not treat the Pterodactyl image as a tested
  Pelican egg.

## [0.1.0] - 2026-10-21

Initial experimental release: [tag and source](https://github.com/alkalines/DASS/releases/tag/v0.1.0)
at [`1d5805e`](https://github.com/alkalines/DASS/commit/1d5805e68c66c0828637bb2b6ac8fcb159a84670).

### Added

- **Client integration:** custom Equicord builds provide DASS sharing/watch UI;
  the plugin-owned Equibop capture adapter avoids a modified host application.
  Discord Desktop publishing was not supported by this release.
  ([`f47b877`](https://github.com/alkalines/DASS/commit/f47b877))
- **Experimental E2EE:** client-side encrypted media with publisher-controlled
  viewer admission, serialized worker epochs and fresh keys on viewer admission.
  These changes do not establish independently reviewed confidentiality.
  ([`5a1db65`](https://github.com/alkalines/DASS/commit/5a1db65),
  [`a61b5cd`](https://github.com/alkalines/DASS/commit/a61b5cd),
  [`34ae84b`](https://github.com/alkalines/DASS/commit/34ae84b))
- **Public transport mode:** authenticated, observed-peer-bound admission and
  bounded resources for experimental Internet transport.
  ([`d165192`](https://github.com/alkalines/DASS/commit/d165192))
- **Administration and persistence:** web-panel session monitoring/stream controls
  and SQLite-backed accounts/configuration.
  ([`b05daee`](https://github.com/alkalines/DASS/commit/b05daee),
  [`c40e68d`](https://github.com/alkalines/DASS/commit/c40e68d))
- **Release distribution:** GitHub Actions packages custom Equicord bundles and
  backend images, with manual-update notifications.
  ([`b19000c`](https://github.com/alkalines/DASS/commit/b19000c))

### Fixed

- **Build dependencies:** removed the unused `zip-local` dependency from the
  dedicated Equicord build adapter.
  ([`1d5805e`](https://github.com/alkalines/DASS/commit/1d5805e))
