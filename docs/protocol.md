# Proposed DASS signaling protocol v1

Discord Alternative ScreenShare (DASS) defines its proposed control-plane wire
types in `crates/protocol/src/signaling.rs`. An optional invite-backed control-plane
endpoint is implemented and passes user-run Docker control-plane tests; see
[control-plane.md](control-plane.md). An opt-in authenticated RTC experiment now
exists; its directory/viewer increment is described in [watching.md](watching.md).
The control contract also defines an authenticated, publisher-scoped
`viewer_presence` notification for accepted subscriptions and their cleanup,
plus a publisher-controlled admission flow (`request_view`, `view_decision`,
`remove_viewer`) where the backend relays and enforces decisions but never
grants viewership itself. These types alone do not enable capture, authorize
clients or establish readiness.

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
The viewer-presence increment adds Rust serialization, scoped lease/queue and WSS
join/leave/disconnect tests. Those new Rust tests were not run in this agent session:
Docker API access was denied. No DASS client runtime acceptance is claimed.

## Contract and intended lifecycle

Each message contains `protocol_version: 1`, a `request_id`, and a tagged
`operation`. IDs are opaque, case-sensitive DASS identifiers: 1–64 ASCII letters,
digits, underscores or hyphens. Discord identifiers confer no authorization.
Server responses echo the request ID; unsolicited close/ICE notifications use a
server-generated ID. `viewer_presence` uses the stable request ID
`server_viewer_presence`; clients route it by operation type and must not treat
that ID as a response to a client request. Never include credentials, full SDP
or message bodies in logs or error text.

The intended connection sequence is:

1. Send `login` or `account_login` as the first operation within five seconds,
   with a separate DASS credential in the body, never in the URL. Authentication
   is service-wide: there are no room grants, roles, scheduled expirations,
   revocation flags or login IP allowlists. Sessions last at most
   `SESSION_LIFETIME_SECONDS` (600 s) from authentication; account removal or
   password reset is the only containment, and any policy reload closes all
   sessions.
2. After `authenticated`, request `join` with an opaque room ID and explicit
   `require_e2ee`. Rooms are discovery grouping only; any authenticated client
   may join or list any room. E2EE is now mandatory end-to-end: `publish`
   requires the publisher's `publisher_key` (base64url ECDH P-256 identity) and
   `request_view` requires the viewer's `viewer_key`, so there is no
   transport-only media mode. `directory` with `room_id` returns up to 64 live
   `publisher_ids` with display names in that room. There is no client update
   operation. Entries come from connected, server-owned publishers.
3. After `joined`, use its session ID for `publish` or the admission flow.
   Publishing registers a live stream entry keyed to the publisher's session
   and account. Watching is **publisher-controlled**:

   - The viewer sends `request_view` with its session ID, a target
     `publisher_id` in the same room and its `viewer_key` E2EE identity. The
     backend answers `view_request_pending` with a server-generated pending
     request ID and pushes the publisher an unsolicited `view_request` (stable
     envelope ID `server_view_request`) carrying the viewer's account ID,
     display name and `viewer_key`. The publisher's client pins that key as
     the admission target: a changed key surfaces as an identity-change prompt
     rather than silently inheriting prior approval. Pending requests expire
     after `VIEW_REQUEST_TIMEOUT_SECONDS` (60 s), are bounded globally (64),
     per publisher (8) and per viewer account (4), and duplicate prompts from
     one account to one stream never queue.
   - Only the publisher session owning the stream may send `view_decision`
     referencing that pending request ID: `approve`, `deny` or `block`. The
     decision is single-use. The viewer receives a pushed `view_decision`
     (stable envelope ID `server_view_decision`); on `approve` it carries an
     opaque `approval_id`, the publisher's `publisher_key` and the publisher's
     `publisher_account` so the viewer can pin the identity against a scope
     that stays stable across stream instances. `deny` imposes a 30 s cooldown
     on further requests from that account on this stream; `block`
     additionally refuses all future requests and terminates that account's
     existing viewer sessions, unused approvals and pending prompts on this
     stream. An expired or withdrawn request pushes `view_request_closed`
     (stable envelope ID `server_view_request_closed`) to the publisher.
   - `subscribe` requires the `approval_id`. The backend consumes it exactly
     once and only for the stream, viewer session and account it names; a
     forged, stale or mismatched ID is rejected. The publisher can withdraw an
     account at any time with `remove_viewer` (`viewer_id` is the viewer's
     account ID), which terminates that account's viewer sessions, unused
     approvals and pending prompts and drops its media route immediately.
   - After approval, the publisher's client wraps the current AES-256 media
     epoch key under ECDH with the viewer's pinned identity and relays it with
     `key_relay` (`viewer_id` names the approved viewer account; `blob` is
     opaque E2EE ciphertext). The backend forwards it only to sessions it
     recorded as approved or watching for that stream; media keys never appear
     to the server. Viewer removal triggers an epoch rotation and a fresh
     relay to remaining viewers so removed viewers keep only past epochs.
   - A publisher going offline or ending its session closes every pending
     request (viewers see a denial), every approved viewer connection and the
     forwarding route. Approvals never transfer to a new stream instance.

   A publisher opts in on its authenticated connection after `publish` is
   accepted:

   ```json
   {"type":"enable_viewer_presence","session_id":"publisher_session"}
   ```

   This requires publish scope and the publisher's own session and returns
   correlated `accepted`. It is accepted before RTC connectivity is established.
   Enable it before viewers subscribe; a first-time opt-in is rejected if a viewer
   is already subscribed, and repeated
   opt-in is idempotent. Older publishers that do not send this operation receive
   no new event and continue to work with strict parsers. When opted in, each
   subsequently accepted `subscribe` causes the authenticated RTC backend to send
   the target publisher an unsolicited `viewer_presence` event, for example:

   ```json
   {"protocol_version":1,"request_id":"server_viewer_presence","operation":{"type":"viewer_presence","session_id":"publisher_session","change":"joined","viewer_count":1}}
   ```

   `session_id` is the publisher's own session ID; no viewer ID or Discord
   identity is disclosed. `viewer_count` is the number of accepted subscriptions
   after the change. `joined` is emitted only after the backend accepts and
   allocates the subscription, before offer/answer/ICE setup; it does **not** mean
   that the viewer's RTC transport or media is connected. A matching `left` event
   follows the viewer's explicit leave, control-session disconnect, expiry,
   revocation, timeout or transport cleanup. No event is emitted for
   rejected/unavailable subscriptions, and events are never broadcast to other
   publishers. The current RTC experiment
   is limited to one publisher and one viewer backend-wide, so its count is at most
   one.

   This is an additive operation in protocol v1: old request/response operations
   and fields are unchanged. A new opt-in client must use a backend that supports
   `enable_viewer_presence`, and an opted-in publisher needs an updated strict
   server-message parser. There is no feature negotiation for this operation.
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
| Queued presence messages per publisher | 32 |
| Pending view requests backend-wide | 64 |
| Pending view requests per publisher | 8 |
| Pending view requests per viewer account | 4 |
| Unused approvals per publisher | 16 |
| View request lifetime | 60 s |
| Deny cooldown per account per stream | 30 s |
| Session lifetime from authentication | 600 s |
| Login deadline | 5,000 ms |
| RTC setup deadline after acceptance | 15,000 ms |

Strings must be nonempty and contain no NUL. The parsers enforce message and field
bounds only. The new server owner implements session/room admission, bounded
replay storage, login/reservation deadlines, publisher-owned view-request
lifecycle and lease cleanup, covered by passing Docker control-plane tests.
Request responses are sent synchronously with a
one-second send bound; publisher pushes (presence, view requests, decisions,
request closes) share the bounded queue above. If that
queue fills, the owning publisher connection is closed as overloaded rather than
silently losing count changes or admission events. RTC queues/setup remain
experimental. Connection
admission counts unauthenticated connections and bounds socket/handshake lifetime;
see [control-plane.md](control-plane.md) for the exact current limits.

No operation carries media frames or previews. Media must use WebRTC DTLS-SRTP,
not JSON or Electron IPC. E2EE is mandatory: encoded frames are AES-256-GCM
encrypted per media epoch on the publisher's device (SFrame-shaped header,
HKDF-SHA-256 key derivation, nonce = per-epoch salt XOR epoch‖counter) and
decrypted only on approved viewers' devices; the backend forwards ciphertext
unchanged and never holds media keys. The frame layout is project-specific:
it is not RFC 9605 SFrame, has no key id and no interoperability, and no
published test vector exists yet. Identity keys are ECDH P-256 with local
TOFU pinning scoped to the peer account, plus an out-of-band safety-number
comparison that marks a pinned identity as independently verified. A changed
publisher key fails closed and pauses admission until it is explicitly
re-confirmed. Authentication, secure signaling, `str0m`, and the real
two-client gate remain tracked in
[transport-gate.md](transport-gate.md); production SFU work is blocked until
that gate passes.
