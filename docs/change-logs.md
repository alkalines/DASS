# Changelog

Notable changes to Discord Alternative ScreenShare (DASS), newest first.
Dates use `YYYY-MM-DD`; commit links identify implementations, not runtime acceptance.
Publication status is recorded by [GitHub Releases](https://github.com/alkalines/DASS/releases), not by an entry's date.
Uncommitted work has no commit ID until it is committed.

> [!WARNING]
> DASS is experimental. Production use and unrestricted public deployment are not recommended. Functional tests are not an independent security audit.

## [Unreleased]

### Added

- **Watch several streams:** one client can watch up to 16 streams at once, each
  in its own tile with independent connection, reconnect and audio; stopping one
  leaves the others. The backend allows 20 connections per account (directory,
  publishing, 16 watches, reconnect slack); an account is meant for one client.
  The plugin now logs in one connection at a time to avoid backend login
  overload. Each watched stream uses its own media slot, so size
  `DASS_MAX_MEDIA_SESSIONS` accordingly.
- **Viewer auto-reconnect:** a watched stream that drops for a transient reason
  (UDP/media loss, server `transport_failed`, setup timeout, socket loss,
  overload) is re-watched automatically after 1, 2, 4, 8 and 15 seconds, with
  the cause shown on the tile. Ended streams, removal, denial, revoked access,
  changed identities and explicit stops are not retried. Publishers re-admit the
  same already-approved device for the current stream without a new prompt.
- **Log copying:** the admin Logs page can copy the selected source's last three
  minutes (at most 100 entries); the plugin settings can copy the client's own
  last three minutes (at most 100 entries), including events that never reached
  the backend.

### Changed

- **Discord desktop picker:** choosing DASS now opens Discord's own Go Live
  picker instead of a separate DASS dialog. Its source, quality and
  stream-audio choices go to DASS without starting a Discord stream. Quality
  ignores Nitro limits (Video and Auto use 1440p60, Documents source resolution
  at 15 FPS, Custom the selected values) instead of the old 1080p30 cap.
- **Discord-style call tiles:** DASS tiles use Discord's own hover overlay, LIVE
  badge with quality, Watch Stream button, loading spinner and menu wording.
- **Change Stream:** the share keeps running while the picker is open, and
  cancelling changes nothing. A new source replaces the live tracks without
  disconnecting viewers; toggling stream audio restarts the share with the
  chosen source.

### Fixed

- **Viewers hearing themselves:** Discord desktop stream audio now uses Windows
  process loopback like Discord's soundshare: a window shares only its
  application's audio, and a screen shares everything except Discord. Screen
  audio needs one Discord restart after enabling DASS.
- **Change Stream closing the share:** choosing **Alterar a Transmissão** no
  longer stops the stream and reconnects before showing the picker.
- **Stream stability:** keyframe bursts no longer overflow 32-packet backend
  queues (now 512 per viewer and per session ingress); a full viewer queue drops
  packets for that viewer and requests a keyframe instead of disconnecting it;
  media budgets drop excess packets instead of closing sessions; ICE
  `Disconnected` gets a 15-second recovery window; large outgoing bursts are sent
  in batches instead of failing; keyframe requests are no longer lost to rate
  limiting, and the forced keyframe cadence dropped from 1 s to 3 s.
- **Rekey blanking:** publishers relay a new media epoch to every approved viewer
  before encrypting with it, and viewers keep one previous epoch, so a viewer
  joining or reconnecting no longer blanks the stream for others.
- **Publish while watching:** re-selecting the current voice channel no longer
  stops both sharing and watching.
- **Error messages:** signaling and media failures explain each code in plain
  language and keep the bracketed code.
- **Publisher stopped by a leaving viewer:** when an approved viewer's session
  ended before its epoch key arrived (for example after an identity-check
  failure), the backend's `rejected:invalid_state` closed the publisher's
  connection and stopped the share. That relay is now skipped; the viewer keeps
  its approval and gets a fresh key when it rejoins.
- **Changed streamer identity:** a watch refused because the streamer's E2EE
  identity changed now explains why on the tile and offers an explicit
  **Trust new identity and watch** action instead of a generic setup error.

### Validation and upgrade notes

- Rebuild the backend **and** both clients. Plugin tests, lint, typecheck and
  bundle builds passed with Bun 1.4.4. On 2026-10-25 the user reported that
  `docker compose build backend` (formatting, Clippy with warnings denied,
  locked tests) succeeded and the backend is running; the later diagnostic
  allowlist addition for skipped relays has not been rebuilt yet.
- Real-client runtime acceptance of reconnection, burst handling,
  publish-while-watching and multi-stream watching is pending.

## [1.0.1] - 2026-10-23

### Added

- **Multi-client sharing:** experimental support for multiple publishers and viewers,
  including publishing while watching another stream. Media sessions share two
  backend UDP ports and remain resource-bounded; each client still watches one
  remote stream at a time.
  ([`4839b5b`](https://github.com/alkalines/DASS/commit/4839b5b))
- **Stream discovery recovery:** reconnect dropped directory connections with
  backoff and use `/dass_refresh` to refresh available streams without stopping
  an active share or watch session. Active media still needs restarting after a
  backend restart.
  ([`b502340`](https://github.com/alkalines/DASS/commit/b502340))
- **Manual Docker image builds:** build either backend image or both without
  creating a release, with optional image publication and a fast-build option
  that skips checks. Skipped checks are not validation.
  ([`a4e213b`](https://github.com/alkalines/DASS/commit/a4e213b),
  [`d48c4bc`](https://github.com/alkalines/DASS/commit/d48c4bc))

### Changed

- **Viewer approval:** automatic approval is now on by default for first-contact
  and unchanged pinned identities; existing saved preferences are retained.
  Disable it to require permission for each watch request. Changed keys still
  require an explicit decision, and same-device rejoining rotates media keys
  without silently replacing an admitted device.
  ([`82de96f`](https://github.com/alkalines/DASS/commit/82de96f))

### Fixed

- **Windows-to-Linux video:** corrected encrypted VP8 frame headers and preserved
  source RTP packet ordering and loss gaps during backend forwarding to address
  corrupted playback. Added separate header-mismatch diagnostics to help
  investigate remaining failures. This is a partial improvement, not a claim
  that all Windows-to-Linux streaming issues are resolved.
  ([`57f57b2`](https://github.com/alkalines/DASS/commit/57f57b2),
  [`3972cdd`](https://github.com/alkalines/DASS/commit/3972cdd))
- **Simultaneous sharing:** ending a watched stream no longer revokes independent
  account access or stops the viewer's own share. Improved capacity-error reporting
  and paced signaling requests for multiple viewers.
  ([`f5e6c82`](https://github.com/alkalines/DASS/commit/f5e6c82))
- **Backend builds:** corrected Rust build errors introduced during multi-client
  transport work.
  ([`2f0a760`](https://github.com/alkalines/DASS/commit/2f0a760),
  [`68dca40`](https://github.com/alkalines/DASS/commit/68dca40))

### Validation and upgrade notes

- On 2026-10-23, the user reported partial improvement when streaming from a
  Windows client to a Linux client. Exact client builds and tested revisions were
  not supplied; full cross-platform runtime acceptance remains pending.
- The VP8 framing change requires **both publisher and viewer** to rebuild and
  restart; older video envelopes are rejected without a legacy or plaintext
  fallback. The RTP forwarding correction also requires an updated backend.
- Backend regression tests for packet reordering, loss gaps and rollover were
  added, but the implementation notes record validation blocked by Docker socket
  access. No new build or media validation is claimed by this changelog update.

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
