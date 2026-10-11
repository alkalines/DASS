# Proposed DASS signaling protocol v1

Discord Alternative ScreenShare (DASS) defines its proposed control-plane wire
types in `crates/protocol/src/signaling.rs`. An optional invite-backed control-plane
endpoint is implemented and passes user-run Docker control-plane tests; see
[control-plane.md](control-plane.md). An opt-in authenticated RTC experiment now
exists; its new directory/viewer increment is described in [watching.md](watching.md).
These types alone do not enable capture, authorize clients or establish
readiness.

## Generate and validate

From the repository root:

```sh
bun scripts/generate-protocol.mjs
bun scripts/generate-protocol.mjs --check
bun test ./tests/plugin
```

The dependency-free generator reads the restricted Rust wire declarations and
writes `crates/protocol/generated/signaling.ts`. Unsupported field types fail
generation. Keep the generated file committed. `generated/validate.ts` provides
client/server runtime parsers; future clients must use them rather than casting
untrusted JSON. Wire changes require updating validators and tests as well.
Rust's `parse_client_message` bounds bytes before deserialization, rejects unknown
fields, and validates version, identifiers and operation payloads. Run all Rust
checks in Docker as described in [backend.md](backend.md). The user validated the
protocol foundation in Docker (formatting, Clippy, 17 Rust tests, locked builds and
runtime image build). The subsequent auth/TLS/WSS increment and additive capability
fields/new `transport_unavailable` code passed user-run Docker validation with 33
Rust tests, Clippy and locked builds. No media interoperability is established.

## Contract and intended lifecycle

Each message contains `protocol_version: 1`, a `request_id`, and a tagged
`operation`. IDs are opaque, case-sensitive DASS identifiers: 1–64 ASCII letters,
digits, underscores or hyphens. Discord identifiers confer no authorization.
Server responses echo the request ID; unsolicited close/ICE notifications use a
server-generated ID. Never include credentials, full SDP or message bodies in
logs or error text.

The intended connection sequence is:

1. Send `login` as the first operation within five seconds, with a separate DASS
   credential in the body, never in the URL. Credential syntax here is only a
   bounded string; the new server increment adds issuance, verification, expiration
   and revocation, covered by passing Docker control-plane tests.
2. After `authenticated`, request `join` with a room ID and explicit
   `require_e2ee`. Room access must be authorized separately from publishing and
   subscribing. Required E2EE must be rejected while E2EE is unavailable.
   Before joining, `directory` with `room_id` returns up to 64 `publisher_ids`
   only with access and subscribe grants. The response echoes the room and request
   ID. There is no client update operation. Entries come from connected,
   server-owned publishers; expired/unauthorized publishers are filtered.
3. After `joined`, use its session ID for `publish` or `subscribe`. A subscription
   targets a server-issued publisher ID in the authorized room. Recheck credential
   validity and the specific permission on **every** operation. No client-provided
   Discord/channel identity participates in permission decisions.
4. After `accepted`, exchange `offer`/`answer` and trickled `ice` within the setup
   deadline. Candidate syntax validation is not ICE destination safety; the RTC
   implementation must enforce address policy before any outbound packet.
5. `leave` releases session resources; expiration, revocation, timeout, overload
   and transport failure cause `closed`. Repeated teardown must be safe. A new
   connection requires authentication again, not implicit session resumption.

The control-plane owner must reject operations before login, repeated login, unknown
sessions, role changes or negotiation in invalid states. Request IDs must not be
reused within a connection. A bounded replay table must reject duplicates rather
than repeating side effects; admission/credential replay protection is a separate
requirement. None of these state or permission checks are implemented by the
structural parsers.

## Bounds

| Bound | Proposed maximum |
| --- | --- |
| Encoded JSON message | 16,384 bytes |
| Credential | 512 UTF-8 bytes |
| SDP | 12,288 UTF-8 bytes |
| ICE candidate | 2,048 UTF-8 bytes |
| Sessions per backend | 128 |
| Members per room | 16 |
| Directory entries | 64 (one live publisher in the current RTC experiment) |
| Outbound messages per connection | 32 |
| Login deadline | 5,000 ms |
| RTC setup deadline after acceptance | 15,000 ms |

Strings must be nonempty and contain no NUL. The parsers enforce message and field
bounds only. The new server owner implements session/room admission, bounded
replay storage, login/reservation deadlines and lease cleanup, covered by passing
Docker control-plane tests. It sends synchronously with bounded buffering rather than using an
application outbound queue. RTC queues/setup remain unimplemented. Connection
admission counts unauthenticated connections and bounds socket/handshake lifetime;
see [control-plane.md](control-plane.md) for the exact current limits.

No operation carries media frames or previews. Media must use WebRTC DTLS-SRTP,
not JSON or Electron IPC. This protocol includes no E2EE keys and promises no
E2EE. Authentication, secure signaling, `str0m`, and the real two-client gate
remain tracked in [transport-gate.md](transport-gate.md); production SFU work is
blocked until that gate passes.
