# Minimal publisher-to-viewer forwarding

This page records the original single-route checkpoint. The current bounded
multi-publisher/viewer increment and its pending runtime acceptance are documented in
[simultaneous-sharing.md](simultaneous-sharing.md); earlier validation below
does not validate that increment.

Discord Alternative ScreenShare (DASS) now has source for a one-publisher/
one-viewer feasibility path inside the existing Rust executable. **User-run Docker
formatting, Clippy and all 41 Rust tests passed; the user subsequently confirmed
the locked workspace/backend image builds completed.** No new image ID or
separate formatting-check output was supplied. The earlier 38-test and runtime-image results apply
to the receive-only checkpoint, not this forwarding increment.
This is not the production SFU in step 4.7 and does not pass the two-Equibop-client
gate. No client capture is enabled; readiness remains 503 and media capabilities
remain false.

## Narrow routing contract

The spike remains disabled unless `DASS_RTC_SPIKE=true`, with TLS, invites and the
explicit IPv4/UDP configuration in [rtc-spike.md](rtc-spike.md). It now reserves
at most **one publisher and one subscriber globally**. The publisher session ID
returned by room join is the `publisher_id` supplied to subscribe. There is no
directory or public publisher enumeration endpoint.

Publisher: authenticate → join a room → publish → send-only SDP offer
with at most one audio and one video m-line → answer → bounded trickle ICE.

Viewer: authenticate → join **the same room** → `request_view` → receive the
publisher's pushed `view_decision` approval → `subscribe` with the single-use
`approval_id` and that publisher's session ID → receive-only SDP offer → answer →
bounded trickle ICE. Rooms are discovery grouping; login alone never grants media.
A subscription for a missing publisher, another room, oneself, an unapproved or
mismatched approval ID, or an occupied slot is rejected without revealing
cross-room publisher presence. Approvals are scoped to one stream instance and
viewer account/session; publisher approval and the exact ICE allowlist are
separate checks.
Required E2EE is still rejected.

Only **Opus and VP8** are enabled. Each RTC has one task owner. Decrypted RTP
payloads cross a bounded in-process channel and are re-encrypted under the
subscriber's independent DTLS-SRTP transport. The backend never decodes,
transcodes, records, or sends media through signaling JSON or Electron IPC.
Transport encryption terminates at the server; this is not E2EE.

The subscriber's negotiation supplies its own SSRC/MID and payload type. The
minimal mapper uses a local sequence counter per media kind, preserving encoded
payload bytes, timestamp and marker. Publisher header extensions/CSRCs are not
copied; str0m generates the negotiated outbound headers. A subscriber may omit
audio/video. There is no source switching, simulcast, renegotiation or ICE restart.

## Bounds and failure behavior

- A 512-packet per-viewer queue with a 2048-byte payload cap; no packets are
  enqueued until the subscriber's server-side DTLS connection is ready. The size
  absorbs one screen-share keyframe burst.
- A full queue drops that packet for the slow viewer only and coalesces a
  keyframe request to the publisher; the viewer keeps its route. A closed queue
  removes the route. The publisher is never delayed and no queue grows.
- Publisher teardown invalidates the route and queued packets; subscriber
  teardown removes its sender. Both socket and RTC admission remain drop-owned.
- Subscriber forwarding drains up to one full queue per owner tick, stopping the
  batch after 50 ms. Outgoing datagrams are written in batches of 32, each batch
  with a 50-ms UDP-send deadline; a larger burst is several batches, not a failure.
- A capacity-one feedback queue coalesces keyframe requests. Publisher PLI is
  limited to one per 500 ms (a request inside that window stays pending), with a
  three-second safety-net request while a ready viewer exists. This is a
  feasibility mechanism, not a production feedback loop.
- Packet and byte budgets drop excess media with at most one warning per second;
  they never end a session, and ICE checks are exempt. ICE `Disconnected` ends the
  session only after 15 seconds without recovery.
- Audio/video send buffers are explicitly limited to 32 packets each. This
  increment does not implement application retransmission caches or NACK repair;
  forwarded writes are marked non-nackable. Library pacing is retained, not a
  measured bandwidth/congestion-control guarantee.
- Prior ICE, SDP, packet-rate, setup, inactivity and lifetime limits still apply.
  Session expiry/policy reload ends the WSS-owned RTC; room membership is not
  authorization, and publisher withdrawal/block drops the route and queued
  packets immediately through `close_publisher`/`drop_viewer`.

Audio/video synchronization currently uses arrival-time wallclock estimates with
original RTP timestamps. Loss recovery, sequence/timestamp wrap, long-running
clock drift, audio/video synchronization and overload behavior need more testing.
Do not make codec-quality, reliability or performance claims from opaque packets.

## Recorded automated test checkpoint

On October 11, 2026, the user supplied passing Docker formatting, Clippy with
warnings denied and workspace test output: **41 tests** (37 backend, four
protocol; no doc-test cases). The new forwarding, subscriber-scope and two-DTLS-
transport tests below passed. The agent records the user's container evidence;
it did not run host Cargo or independently run Docker.

- Hub tests cover exact room/publisher binding, exclusive roles, bounded queues,
  keyframe coalescing, slow-viewer isolation, replacement and source teardown.
- `two_dtls_peers_forward_opus_and_vp8_payloads_without_transcoding` negotiates
  independent publisher/subscriber UDP DTLS transports, sends opaque audio/video
  payloads, verifies fidelity/timestamp/marker and different negotiated payload
  types, then checks admission and route cleanup. These are Rust test clients,
  not Chromium/Equibop clients or valid codec playback evidence.
- Existing WSS authorization/negotiation/revocation tests remain relevant and
  must pass again with the new role-aware implementation. Combined authenticated
  two-client forwarding and real capture/playback still need coverage.
- A signaling-level test checks same-room source binding, successful subscriber
  SDP with a consumed approval, expiry rejection before ICE parsing, and
  publisher-drop invalidation of the viewer route. New unit tests cover
  publisher-owned bounded pending requests, single-use decisions, deny cooldown,
  block/remove withdrawal and offline-publisher cleanup; they were written for
  this change and remain unexecuted (Docker unavailable).

Run from the **DASS repository root** in your `sudo su` shell:

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo clippy --workspace --all-targets --locked -- -D warnings
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
```

Stop at the first failure and share output. **No dependency/lockfile update is
needed.** After tests pass, run the formatting check, locked workspace build and
backend image build. The agent does not run host Cargo or change Docker access.

Those tests passed and the user subsequently reported the following builds
completed. These are repeatable validation commands, not a request to regenerate
the lockfile:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo build --workspace --locked
docker compose build backend
```

The short build confirmation does not establish running-container health,
browser connectivity, client-trusted TLS, or real codec playback. No new image
identifier or separate formatting-check result is recorded.

Next after this checkpoint: a minimal Equibop viewer and installed-picker capture
adapter, verified local UDP publication and client-trusted TLS topology, then
the recorded video/explicit-audio/voice/teardown/no-Discord-leakage checklist in
[transport-gate.md](transport-gate.md). Full SFU work stays gated on those results.
