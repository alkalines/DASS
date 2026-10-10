# DASS agent instructions

These instructions apply throughout the DASS monorepo.

## Scope and architecture

- Read `docs/research/PLAN.md` before work.
- Build an Equicord plugin plus backend infrastructure; no client helper executable,
  daemon, local proxy, FFmpeg/GStreamer subprocess or native DASS encoding process.
- Use existing Equibop capture/venmic integration and Chromium WebRTC encoders.
- Keep ordinary Discord voice independent. DASS viewers need compatible software;
  never claim stock Discord receives custom SFU media without evidence.
- Prefer the proposed single Rust service and packet-forwarding SFU; record stack
  changes in an ADR and validate dependencies before adding them.
- Do not spawn subagents unless the user explicitly authorizes them.

## Security and privacy invariants

- No Discord user token extraction or transmission to DASS.
- Require authenticated, scoped publish/subscribe access; client identity/channel
  claims are not authoritative authorization.
- TLS/WSS and DTLS-SRTP are mandatory outside explicit local development.
- Distinguish transport encryption from E2EE; never silently downgrade required E2EE.
- Do not invent cryptography. Use reviewed protocols/implementations and test vectors;
  document key distribution, rekeying, counters and replay protection.
- Keep media keys away from the backend for the server-untrusted E2EE threat model.
- Never log credentials, keys, full SDP, captured frames or sensitive identifiers.
- Never silently fall back to Discord media or upload DASS preview thumbnails there.
- Preserve source-picker consent and visible capture state. Stop tracks on every exit.
- Bound queues, payload sizes, handshakes, packet caches and connection/session counts.
- Avoid open TURN relays and restrict unsafe server-side candidate destinations.

## Implementation conventions

- Isolate private Discord hooks in the plugin adapter; pin and record upstream builds.
- Prefer host Equicord APIs/React over duplicate client framework dependencies.
- Keep plugin lifecycle cancellation, teardown and repeated stop deterministic.
- Keep media packets out of control-plane JSON and Electron IPC.
- Use one owner for each RTC state; avoid global packet-path locks and blocking I/O.
- Keep generated TypeScript protocol types consistent with server schemas.
- Commit lockfiles; review licenses, advisories and transitive/native build requirements.
- Do not download executable code at runtime, change remotes, push or deploy without
  explicit authorization. Preserve unrelated user changes.

## Validation and reporting

- Complete the feasibility gates before treating architecture assumptions as facts.
- Run appropriate lint/type/tests for changed code; document commands once implemented.
- Test invalid authorization and fail-closed behavior alongside happy paths.
- Exercise real Equibop Wayland/X11 capture, optional audio and lifecycle cleanup.
- Benchmark named hardware and scenarios; no unmeasured efficiency/capacity promises.
- Test reconnection and node failure; replicated metadata is not seamless media failover.
- Report what was tested, what was not, and outstanding compatibility/security gates.
- Keep operational services server-side; clarify scope before adding any new process.
