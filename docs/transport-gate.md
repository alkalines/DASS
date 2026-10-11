# Rust transport implementation gate

Discord Alternative ScreenShare (DASS) still has a discovery-only Rust backend.
Authentication, room authorization, secure signaling and WebRTC transport are
**not implemented**. Do not enable the capture prototype based on its unit tests.

## Current blocker

This session's `docker info` failed with permission denied on
`/var/run/docker.sock`. No host Cargo fallback, socket permission change or
dependency/lockfile update was attempted. Backend implementation requiring new
dependencies and Docker validation is deferred until the user provides Docker
access. The existing readiness and unavailable-capability responses are unchanged.

## Required implementation order

1. Review and pin a maintained DASS credential-verification implementation and
   HTTPS/WSS crypto provider. Resolve intentional dependency additions in Docker,
   commit `Cargo.lock`, then use locked builds/tests. Keep one Rust executable;
   do not create a separate signaling service.
2. Add invite-only DASS identities and expiring, revocable room permissions for
   publish and subscribe. Discord identity/channel claims confer no authority.
   Reauthorize each operation and disconnect expired/revoked sessions. Bound
   credentials, room membership, sessions and unauthenticated connections.
3. Add TLS/WSS signaling with strict message validation, bounded queues, setup
   deadlines and an exact Origin policy. Browser connections use short-lived
   single-use tickets or a timed first-message login; never credentials in URLs.
   Require secure transport except explicit loopback development. Required E2EE
   must fail closed while it is unavailable. Never log credentials or full SDP.
4. Review and pin str0m and a single crypto provider. Implement a bounded,
   single-owner RTC/UDP loop for the minimal interoperability spike, including
   safe server-side ICE destination restrictions. Do not implement multi-viewer
   SFU routing yet.
5. Run two actual Equibop clients against this Rust transport before SFU work.
   Record exact Equibop/Equicord/Discord revisions, OS/display-server versions,
   server image/dependency lock, codec and scenario. Leave readiness at 503 and
   media capabilities unavailable until their advertised behavior is operational.

## Two-client evidence checklist

- Publisher uses the installed picker/capture function and viewer receives video
  plus explicitly selected share audio through the Rust WebRTC endpoint.
- Video-only, cancellation, source end, stop, logout, plugin disable and context
  exit leave no capture tracks, venmic link, sockets or listeners behind, including
  failures during audio acquisition and pending capture.
- Test Wayland and X11 separately; ordinary Discord voice continues independently.
  Scoped network tracing verifies no DASS frames/previews go to Discord.
- Verify DTLS-SRTP negotiation, supported codecs, secure signaling/worker policy,
  credential expiry/replay/revocation, unauthorized rooms/roles, malformed and
  oversized SDP/ICE, unsafe ICE destinations and E2EE downgrade rejection.
- Exercise disconnect/reconnect and backend restart. Do not claim node failover,
  TURN, E2EE or performance support without their separate evidence.

No checklist item above is marked passed. Only after the gate passes should SFU
packet mapping, feedback, pacing and bounded retransmission caches be implemented.
