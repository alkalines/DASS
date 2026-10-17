# DASS security roadmap

Discord Alternative ScreenShare (DASS) uses an E2EE-only design for streams, with
separate security gates for a limited Internet pilot and public multi-user hosting.
This roadmap is implementation guidance, **not a
security certification or authorization to deploy**. No system is risk-free.

This document describes a connected implementation plan, independently of current
progress. Numbered items are stable references, not isolated agent prompts or
completion indicators. Keep the design here and provide one concise handoff at the
end of an assigned implementation task. Record design revisions in section 11.

The target design excludes transport-only streams, login IP allowlists, scheduled
account expiration, administrator login-revocation flags and administrator-managed
room permissions. Login still requires
authentication, password protection and abuse limits. Stream approval withdrawal,
credential reset, cryptographic key rotation, request deadlines and
session cleanup are separate safety mechanisms and remain required. Removing login
controls reduces the operator's containment options; document the recovery policy
and residual risk rather than assuming E2EE prevents account abuse.

The deployment target is the public Internet. LAN is only a test environment, not
a product mode or a source of trusted identity. Rooms are call/discovery context,
not permission boundaries: there are no room ACLs, per-room publish/subscribe grants,
wildcard grants or room block/unblock controls. Authenticated users publish their
own streams; each publisher controls who may decrypt their stream through the
approval policy and E2EE membership protocol. Authentication and bounded abuse
controls remain service-wide, never administrator-issued room admission.

Section 12 maps only practical operational requirements to a minimal Admin
Dashboard. Research, protocol design and validation remain outside the panel.

## How the steps fit together

Read the shared design above and the dependencies below before changing a section.
The numbering groups related work; use this implementation order rather than
treating each subsection as an independent project:

| Order | Sections | Build on / deliver to the next task |
| --- | --- | --- |
| A | 1 | Understand the shared rules and locate the existing code to change. No separate planning report required. |
| B | 2 and 3 | Define authenticated account/device identity, publisher approval and stream/session lifecycle together. Remove legacy room/login controls without treating old grants as approvals. |
| C | 8 | Bind those approvals to pinned identities, AES-256 media encryption, key distribution and rekeying. Do not enable stream delivery before this works end to end. |
| D | 4 and 5 | Carry the same sessions and encrypted stream over public client-to-server transport with safe admission, limits and cleanup. No P2P, LAN trust or alternate authorization model. |
| E | 6 and 12 | Connect the existing capture/viewer lifecycle and minimal dashboard to those same accounts, streams and events. The dashboard adds visibility, not new authority. |
| F | 7, then 9 | Test the assembled system, obtain review and operator approval for deployment, then address public capacity and ongoing maintenance. |

This order describes implementation, not permission to deploy. Section 10 applies
to every assigned task. Related work can be grouped into one assignment; do not
spawn agents from this document without explicit authorization.

Use one shared flow across backend, protocol and client:

```text
Authenticate account/device → publisher starts an E2EE stream
→ viewer requests that stream → publisher accepts the pinned identity
→ reviewed key-management protocol provides the current media epoch
→ server forwards ciphertext → viewer decrypts locally
→ removal/stop closes the route and rekeys or destroys the stream context
```

Agree shared message types and lifecycle transitions before implementing callers.
Use the same account/device, request, stream-instance and epoch identifiers across
the related steps, with generated protocol types. Do not invent a second identity,
approval queue or session owner for the dashboard or another controller. If a
dependency is missing, implement it only within the assigned scope or identify the
blocker; never bypass it with a temporary room grant or transport-only stream.

## 1. Keep the shared security rules consistent

- **1.1 Protect the agreed information.** Streams are confidential from the
  backend; credentials and keys are never diagnostics. Participants do not receive
  each other's IPs. Minimal admin metadata is limited to section 12.
- **1.2 Keep the limits honest.** Publisher-approved viewers can record or share
  what they receive. TOFU cannot detect interception on first contact. A hostile
  server can observe connection metadata and deny service. Compromised endpoint
  software can steal plaintext; E2EE does not solve that.
- **1.3 Inspect the relevant existing code.** Find the backend, protocol and
  client owners for the assigned change and reuse their lifecycle. Check code and
  tests, not assumptions from older documentation. Do not turn this into a separate
  inventory/report task before doing the requested implementation.
- **1.4 Preserve the product decisions.** Public Internet, server-relayed media,
  mandatory AES-256 E2EE, publisher-controlled viewers, informational rooms and a
  minimal dashboard apply to every later step. Do not reopen them independently.

**Check:** the assigned implementation follows these rules without adding another
permission system, product mode or client helper process.

## 2. Enforce publisher-controlled stream admission

**Connects to:** account/device authentication in 3 and cryptographic membership
in 8. The approval decision and the recipient receiving key material must refer to
the same identity and stream instance. Section 12 only displays this state.

- **2.1 Separate context from authority.** Use room/call identifiers only for
  grouping and discovery. Authenticate accounts and stream ownership, but never
  require an administrator's room permission to publish or request viewing.
  Bind each subscription to the exact publisher, stream instance and approved
  viewer identity/session. A matching room ID alone never authorizes decryption.
- **2.2 Use publisher-issued stream admission.** Design authenticated, bounded,
  replay-resistant approval requests and decisions for individual live streams.
  Specify how the publisher's client authenticates the intended viewer and
  authorizes E2EE key distribution. The backend relays and enforces decisions;
  it does not issue room grants. Same-call automation requires the evidence in
  2.8, not a client-claimed channel ID. Never extract Discord user tokens.
- **2.3 Remove room permission machinery.** Exclude room ACLs, per-room
  publish/subscribe roles, wildcard grants and room block/unblock controls from
  the target backend, protocol, configuration and dashboard. Plan an explicit
  migration rather than silently reinterpreting legacy grants as publisher
  approvals. Room membership is informational and conveys no stream access.
- **2.4 Make publisher removal effective.** Publisher withdrawal of approval,
  credential reset, stream membership removal and publisher stop must terminate
  affected routes and queued output within a documented, tested bound, with
  client-side rekeying where necessary. Reconnection must establish current
  publisher approval; old sessions/tickets must not regain access.
- **2.5 Test hostile clients.** Cover guessed room/stream IDs, unapproved
  subscriptions, publisher impersonation, stale approvals, replay and removal races,
  unauthorized directory/preview access and malicious account labels.
- **2.6 Route viewing decisions to the publisher.** Administrators manage basic
  accounts and service-wide safety limits, never room or stream recipient grants.
  An authenticated viewer requests a particular live stream;
  the backend sends a bounded request to its authenticated publisher, and only
  that publisher may approve/deny it. Login is necessary but never sufficient
  to receive media. The publisher's authenticated E2EE membership
  decisions prevent a hostile backend from silently adding decrypting recipients.
- **2.7 Define explicit approval policies and safe defaults.** Provide manual
  approval, publisher-maintained preapproval for selected DASS accounts, and a
  proposed same-call automatic policy. Default to manual approval until same-call
  verification satisfies 2.8. Make policy scope, pending requests and approved
  viewers visible to the publisher; include deny, revoke and block controls.
  Default individual approvals to the current stream session. Remembered
  preapprovals require explicit publisher consent, documented scope/expiry and
  removal controls. There is no administrator grant that can override the
  publisher's recipient decision.
- **2.8 Establish what “in the same Discord call” proves.** Auto-approval
  needs both an authenticated binding between a DASS account and Discord identity
  and trustworthy, fresh evidence that the viewer belongs to the publisher's
  current call. Neither a claimed channel ID, display name, client-reported member
  list nor ordinary Discord login proves both. Document the source, freshness,
  revocation and supported call types of any membership verification mechanism;
  do not assume OAuth provides voice membership. If no reviewed mechanism exists,
  show same-call hints as unverified and require explicit publisher approval.
  Never extract Discord user tokens. If proposed as the eventual default,
  same-call approval remains gated on this evidence and visible publisher consent.
- **2.9 Enforce approval on the backend, not just in the UI.** Bind requests
  and decisions to unpredictable request IDs, the authenticated publisher owner,
  authenticated viewer account/session, room, stream instance and expiration.
  Decisions must be single-use/idempotent with explicit state transitions. Reject
  forged approvals, cross-stream reuse, duplicate races and stale decisions after
  restart/reconnect. Do not allocate a forwarding route or release media, audio,
  thumbnails or content-bearing previews before approval. Define separately which
  minimal directory metadata an authenticated requester may discover.
- **2.10 Bound and revoke delegated access.** Limit pending requests per
  viewer, publisher and backend; add cooldowns, timeouts, deduplication and blocks
  so prompts cannot be used for harassment or denial of service. Publisher offline,
  no response or verification failure means no admission. Approval withdrawal
  and stream end must close the route and discard
  pending output within a tested bound. Same-call mode must remove access when
  verified membership ends or its evidence expires; remembered preapproval must
  not silently override a more restrictive active policy.
- **2.11 Test bypasses without assuming official clients.** Test a custom
  malicious viewer that sends subscribe directly, impersonates identities,
  fabricates same-call claims or approval messages, floods prompts, and replays
  approvals across accounts/streams. Cover policy changes, publisher/session
  replacement and revocation races. Modified clients need no merged malicious PR
  to attack; the backend must enforce the policy independently of client UI.
  A compromised server can still bypass its own transport checks; protection
  against that requires step 8's publisher-authenticated E2EE membership and keys.

**Check:** positive and negative integration tests prove stream isolation and
bounded viewer removal, with publisher-controlled admission always enforced; no
reliance on UI-only restrictions or unverified Discord claims.

## 3. Harden authentication, secrets and administration

**Connects to:** 2 authenticates who sends approvals; 8 binds that account/device
to a locally pinned cryptographic identity. A password reset must not silently
replace that identity or inherit verified-recipient status. Reuse this account
model in Users (12.1), without adding room permissions back.

- **3.1 Review account lifecycle.** Retain separate DASS credentials and
  reviewed Argon2id parameters. Add bounded global, per-source and account-aware
  login controls, including expensive hash verification concurrency. Test password
  spraying, username enumeration and attacker-induced account lockout/slot theft.
  Do not include login IP allowlists, scheduled account expiration or administrator
  login-revocation flags in the target account model or dashboard. Specify migration
  from those controls explicitly, without silently broadening access in a running
  deployment. Per-source abuse throttling is not an IP allowlist.
- **3.2 Define session and recovery policy.** Document session lifetimes,
  rotation, replay protection, multi-device behavior and secure provisioning/reset.
  Recovery must not bypass authorization. Never place credentials in URLs or logs.
- **3.3 Verify client storage.** Remember secrets only with explicit consent
  and OS-backed encryption, with no plaintext fallback. Test unavailable/locked
  keyrings, logout, removal, backend-origin changes and startup auto-login.
- **3.4 Isolate administration.** Keep the panel disabled by default and
  private/network-restricted for the pilot. Review Basic-auth verification cost,
  CSRF/Origin protections, output escaping, brute-force controls and separation of
  administrator versus media privileges. Require strong separate admin credentials;
  decide stronger authentication requirements before public administration.
- **3.5 Protect stored policy and secrets.** Review file/environment access,
  Docker-admin visibility, atomic persistence, backup encryption, restoration,
  secret rotation and stream-permission removal persistence across crashes/restarts.

**Check:** tested credential lifecycle, secure-storage failures, hostile
admin requests and restart-safe authorization policy, with no secret disclosure.

## 4. Build an explicit Internet transport mode

**Connects to:** the sessions from 2–3 and the ciphertext from 8. Connectivity
checks authorize network delivery only, never viewer membership. Apply 5's bounds
and 6.4's participant-IP privacy to every normal and fallback path.

- **4.1 Design for the public Internet.** Replace LAN-only address assumptions
  with reviewed public-client RTC admission and public server addressing. LAN
  remains a test environment only. Do not trust a client because it has a private
  address or require a LAN peer-IP match as the product's admission mechanism.
  Bind candidate processing and connectivity checks to authenticated media sessions
  while retaining destination-abuse protections. Public exposure still requires
  explicit deployment authorization and the security gates in this roadmap.
- **4.2 Authenticate signaling and media bindings.** Validate HTTPS/WSS
  certificates and negotiated DTLS fingerprints. Bind SDP, ICE credentials,
  candidates and media ownership to the authenticated session. Bound negotiation,
  candidate processing, handshakes and retries; reject unsupported transports.
- **4.3 Design NAT traversal.** Test server/public address advertisement,
  home NAT, carrier-grade NAT, restrictive UDP networks and IPv4/IPv6 as supported.
  Decide STUN/TURN requirements explicitly. Any TURN must use short-lived scoped
  credentials, quotas and an approved deployment design, never an open relay.
  Do not add a service or assume TURN support without authorization and evidence.
- **4.4 Prevent network abuse.** Review all server-side destinations and
  pre-authentication responses: no arbitrary internal/metadata scanning, SSRF,
  reflection or amplification. Test spoofed UDP, forged ICE, unsafe addresses,
  address parsing and DNS rebinding if names are accepted. Rate-limit invalid
  traffic and bound egress, not just incoming requests.
- **4.5 Preserve observed-peer semantics.** Never trust client IP claims or
  forwarding headers. If a reverse proxy/load balancer is proposed, separately
  review how authenticated peer identity survives it. Use observed source IPs for
  diagnostics and bounded abuse controls, not as proof of identity or room access.
  Account for legitimate differences between signaling and media paths under NAT.

**Check:** approved clients on separate Internet networks exchange encrypted media
under the supported topology; hostile candidates/packets cannot turn the backend
into a scanner or relay. A port-forward alone does not meet this gate.

## 5. Harden Internet-facing operations and resource limits

**Connects to:** the actual authentication, approval, key-management and transport
work in 2–4 and 8. Bound their existing queues and owners rather than adding a
parallel control service. Only the small summaries in 12 belong in the dashboard.

- **5.1 Require secure deployment configuration.** Use trusted certificates,
  HTTPS/WSS and DTLS-SRTP, with tested renewal/expiry behavior. Reject insecure
  development configuration for publicly reachable services. Define the public
  hostname/address, firewall and exposed-port requirements; keep administration
  restricted separately from public client access. Design deployment configuration
  for Internet use, not LAN-only defaults. Local test harnesses do not establish
  deployment security or authorize exposing a running service.
- **5.2 Budget all resources.** Bound sockets, handshakes, password checks,
  WebSockets, sessions, rooms, UDP work, caches, pending signaling and media queues.
  Define ingress/egress bitrate and packet-rate limits with fair admission so one
  account/source cannot monopolize the service. Increase capacity limits only
  when routing and isolation support the larger topology.
- **5.3 Test overload.** Exercise slow clients, connection churn, handshake
  floods, invalid UDP, oversized/malformed SDP/ICE/messages and slow viewers.
  Verify bounded memory/CPU/egress and continued cleanup. Application limits cannot
  stop upstream link saturation; document hosting-provider DDoS protections and
  residual availability risks.
- **5.4 Retain runtime isolation.** Keep one Rust backend executable, non-root,
  capability-free, resource-bounded and read-only except narrow policy storage.
  Review image provenance/digests, minimal packages and permissions. Never mount
  the Docker socket or introduce a TypeScript control-plane server.
- **5.5 Add privacy-safe operations.** Collect bounded aggregate metrics and
  minimal security events without credentials, keys, full SDP, captured frames or
  unnecessary identifiers. Define access, retention/deletion and alerting. Test
  backup/restore, crash recovery and restart behavior. Keep readiness/capabilities
  truthful; do not set readiness true just to satisfy deployment tooling.

**Check:** resource use stays within defined bounds under overload; certificate
renewal and recovery work without weakening authentication or E2EE.

## 6. Verify capture consent and client privacy

**Connects to:** the approved E2EE session from 2 and 8, transported by 4.
Capture controllers, viewer controllers and backend routes must agree on start,
cancel, removal and stop. Failures in any layer must trigger the same cleanup.

- **6.1 Preserve the host capture boundary.** Use the installed Equibop picker
  and capture function, existing audio integration and Chromium codecs. Add no
  helper executable or parallel capture pipeline. Microphone capture is never
  implicit; audio selection and visible capture state must remain explicit.
- **6.2 Test every teardown path.** Cancellation, source end, stop, logout,
  disable, voice-context exit, expired access, server failure and partial setup
  must stop tracks, audio links, peers, workers/listeners and endpoint admission.
  Include repeated teardown and cancellation during pending capture/audio setup.
- **6.3 Prove no silent media leakage.** With scoped network inspection on
  supported client builds, verify DASS sharing does not create Discord media
  streams or upload preview thumbnails, including failed patches and reconnects.
  Discord voice must continue independently. Patch failure must be visible and
  fail closed, never silently switch the chosen DASS action to Discord sharing.
- **6.4 Document metadata exposure.** Explain which IPs and identifiers the
  server can observe. Require client-to-server media routing, never direct viewer/
  publisher P2P, and do not relay participants' addresses or ICE candidates to other
  users. Test NAT/firewall fallback paths without weakening that boundary. Removing
  login IP allowlists does not remove safe RTC destination/admission checks.
  The backend still observes client IPs; do not claim IP anonymity from it.

**Check:** real-client consent, teardown and leakage checks pass for
each supported OS/display-server/build combination; builds alone do not qualify.

## 7. Pass the E2EE Internet pilot gate

**Depends on:** the integrated behavior in 1–6 and 8, not just individual unit
tests. Run this after implementation; it is not preliminary paperwork for each task.

- **7.1 Complete steps 1–6 and 8 for the supported pilot scope.** Resolve critical
  security findings; explicitly record residual risks and unsupported scenarios.
  Review dependencies/advisories and run applicable protocol fuzz/negative tests.
- **7.2 Perform independent review.** Obtain a security review of authentication,
  authorization, E2EE, RTC admission, deployment and client lifecycle. Record reviewer,
  scope, findings and retest evidence, rather than describing self-tests as an audit.
- **7.3 Obtain explicit operator approval.** Start only with invited users,
  private administration, a conservative capacity limit and an agreed monitoring/
  rollback plan. Disclose metadata exposure and the trust assumptions of TOFU versus
  independently verified identities. No pilot exception permits transport-only
  streams. This roadmap does not authorize exposing ports or deploying.
- **7.4 Run and document the pilot.** Test separate networks, loss/reconnect,
  revocation and backend failure. Record incidents and capacity on measured hardware.
  Limit compatibility, privacy and availability claims to the evaluated scope.

**Check:** a limited E2EE pilot passes its tests with explicit identity-trust
assumptions. This does not permit unrestricted public signup.

## 8. Require E2EE for every stream

**Connects to:** the account/device and stream approval contract in 2–3. Build
this before enabling the public media flow in 4–7. Encrypt once per encoded unit
and forward copies: additional viewers require key distribution and server egress,
not another publisher upload or server-side codec pipeline.

- **8.1 Review the protocol before implementation.** Choose a maintained,
  reviewed encoded-frame encryption implementation compatible with supported
  Chromium builds. Specify authentication, AEAD/nonces, replay protection,
  sender/track binding and behavior under loss/reordering. No homemade cryptography.
- **8.2 Authenticate participants and distribute keys.** Media keys must
  never reach the backend. Define independent identity verification or another
  reviewed trust mechanism that prevents a malicious signaling server from
  substituting identities/keys or inserting an invisible recipient. Sending
  unverified keys through WSS alone does not meet this requirement. In the TOFU
  policy of 8.6, the first explicitly accepted key is the trust anchor, not proof
  of the person's identity; substitution protection starts after that pin. Tests
  and UI must preserve this distinction rather than promise verified first contact.
- **8.3 Implement membership key lifecycle.** Define join/leave/revocation
  rekeying, key epochs, reconnect/restart handling, key retention/erasure limits,
  and intended history/future-access guarantees. Removing a viewer cannot revoke
  material they already received or prevent their recording.
- **8.4 Fail closed.** All streams must reject unavailable transforms,
  unsupported viewers, bad authentication and downgrade attempts before exposing
  media. No temporary plaintext frames during startup, rekey or fallback. Make
  active E2EE and independently verified versus TOFU-only identities unambiguous.
- **8.5 Validate independently.** Use published test vectors and adversarial
  tests for tampering, replay, nonce reuse, identity substitution, membership races
  and malicious signaling. Test client compatibility/performance and obtain an
  independent cryptographic review before claiming server-untrusted privacy.
- **8.6 Show E2EE identity trust, not a transport-only option.** Every stream
  requires E2EE in addition to HTTPS/WSS and DTLS-SRTP. Show either **E2EE — identity
  independently verified** or **E2EE — identity unverified (TOFU)**, reflecting the
  actual approved recipients. TOFU requires explicit first-contact acceptance and
  local identity pinning; warn that a malicious first contact remains possible.
  Let publishers require independent verification as a saved policy. Do not expose
  a server-readable stream mode or a switch that disables E2EE.
- **8.7 Bootstrap key trust independently of the server.** Evaluate a reviewed
  identity-key and authenticated key-agreement design with an out-of-band QR code
  or safety-number comparison. The comparison must bind both participants' keys
  and the intended identities; an unverified server-provided name/key pair is not
  identity proof. Compare through an independently authenticated channel or in
  person, not through the same potentially hostile DASS signaling channel. Pin
  verified identities locally and require explicit reverification after unexpected
  key changes. Trust-on-first-use alone cannot prevent a malicious first contact.
  Self-signatures or HTTPS certificates issued to the DASS server do not solve
  this bootstrap problem. Multi-device enrollment and recovery must not let the
  backend silently replace verified identity keys; evaluate transparency only as
  a separately reviewed enhancement with its own trust assumptions.
- **8.8 Bind approvals, keys and encryption policy together.**
  Publisher approval must select the locally pinned recipient identity/device
  accepted under the publisher's verification policy, not just
  an account label returned by the backend. Use the reviewed protocol to
  authenticate session/stream context, recipient membership, mode and key epochs;
  the backend may relay encrypted key material but never receive media keys.
  Reject devices outside the accepted membership and test a server that rewrites
  pinned/independently verified public keys,
  claims a reset, adds recipients or strips E2EE capabilities. Verify both sides
  reject these attacks without releasing decryptable content to the server.
- **8.9 Prevent downgrade and silent identity replacement.** An unsupported
  viewer is refused, never accommodated by a transport-only copy of the stream.
  A failed E2EE start must not automatically retry without E2EE. Unexpected identity
  changes must pause admission and require explicit review, invalidating previous
  verification and never silently inheriting viewer approval. Bind trust-policy
  changes to authenticated membership/session transitions; enforce stricter policy
  on existing recipients before releasing further media. A malicious server may
  still deny service. These guarantees
  assume a trusted installed client; server-supplied executable code or a
  compromised client/update can defeat verification and steal plaintext/keys.
- **8.10 Require AES-256 for symmetric E2EE media encryption.** Use 256-bit
  symmetric key material with an authenticated AES-256 construction supported by
  the selected reviewed media protocol, such as AES-256-GCM. The exact cipher
  suite, key derivation, authentication tags, nonce construction and usage limits
  must be reviewed together; AES-256 alone is not a complete protocol. Generate
  fresh key material with a cryptographically secure random source and follow
  the protocol's per-sender/track/epoch key separation and nonce-uniqueness rules.
  Never use unauthenticated encryption, invent frame cryptography or silently
  downgrade to another cipher. Confirm library/client interoperability and test
  vectors before claiming support. This requirement concerns the additional
  E2EE media layer, not a claim about negotiated TLS or DTLS-SRTP cipher suites.
- **8.11 Preserve one-upload, multi-viewer forwarding.** Distribute the
  current media epoch's key material only through authenticated, confidential
  channels to approved viewer identities/devices, using the reviewed key-management
  protocol. Encrypt each encoded media unit once per published quality layer;
  the backend forwards copies of the same E2EE ciphertext without media keys,
  decoding or transcoding. Keep per-viewer key-management messages separate from
  media fan-out. Rotate epochs on removal and, if past-content isolation is
  required, on admission; never distribute prior epoch keys to new viewers.
  Measure encryption overhead and rekey traffic separately from the unavoidable
  server egress of one media copy per viewer. Verify that signaling, SDP/ICE and
  diagnostics do not disclose other participants' network addresses to clients.

**Check:** reviewed protocol and implementation, test vectors, real-client
tests and explicit residual-risk disclosure. E2EE does not hide traffic metadata,
protect compromised clients, guarantee availability or stop authorized recordings.

## 9. Gate public multi-user hosting and maintain security

**Depends on:** the assembled system tested in 7. Increasing viewer counts must
preserve 8.11's one-upload forwarding, 2's publisher decisions and 5's bounds.

- **9.1 Review multi-user isolation and scale separately.** Before expanding
  to larger multi-publisher/multi-viewer topologies, test cross-account/stream isolation,
  per-user fairness, abuse reporting, account lifecycle and realistic load.
  Re-run security gates after topology, capacity or trust assumptions change.
- **9.2 Define release claims.** Public hosting requires steps 1–8 plus this
  public-hosting gate. E2EE is mandatory, not an optional release tier. Disclose
  first-contact risks of TOFU; do not claim independently authenticated recipients
  unless their keys have actually been verified. WebRTC encryption alone is not E2EE.
- **9.3 Establish supply-chain maintenance.** Review Rust, TypeScript, Electron,
  Equicord/Equibop and native dependencies, licenses and advisories. Preserve reviewed
  lockfiles and upstream pins, document build provenance, and authenticate release
  artifacts/update delivery. No runtime downloads of executable plugin code.
- **9.4 Prepare incident response.** Publish a private vulnerability-reporting
  channel, triage ownership and patch policy. Practice credential/key rotation,
  stream permission removal, secure recovery, user notification and rollback without
  restoring removed stream permissions. Account containment must use the documented
  recovery policy, not reintroduce removed login-revocation/expiry/IP-list controls.
  Never gather stream contents as incident diagnostics.
- **9.5 Revalidate releases.** Run security regression checks and supported
  client/network acceptance after relevant changes. Keep known limitations,
  operator guides and capabilities aligned with evidence; schedule periodic review.

**Check:** public capacity, independent review/retests, maintenance ownership and
incident recovery are addressed before expanding deployment.

## 10. Instructions for future agents and task handoff

**10.1 Work on the assigned change with the shared context.** Read `AGENTS.md`,
the shared design and implementation order, the assigned section and its connected
sections. Inspect the actual dependency implementations and any previous handoff;
do not assume another agent completed them. Do not implement the entire roadmap
or deploy from it without authorization. Load the Equicord plugin skill for client
implementation/debugging. Preserve the single-Rust-backend architecture and
separate protocol/client/backend responsibilities.

**10.2 Validate within project constraints.** Rust dependency resolution,
formatting, linting, compilation and tests run only in Docker. From the repository
root, `docker compose build backend` runs the existing locked backend checks and
build. Use the documented tooling image for formatting or intentional dependency
maintenance; never fall back to host Cargo. Run applicable Bun client tests,
protocol-generation freshness checks and plugin builds for client/protocol changes.
If Docker or real-client access is unavailable, record blocked checks explicitly.

**10.3 Finish with one concise handoff.** At the end of the assigned task, summarize
the implementation and tests together. No report, approval ceremony or status
annotation is needed after each numbered item. Use the final response unless a
separate report file was requested. Include only what the next agent needs:

```text
Assigned change and files changed:
Shared interfaces/lifecycle decisions the next task must reuse:
Tests run, results and anything not tested:
Remaining issues/dependencies and the next useful action:
```

**10.4 Keep claims and permissions accurate.** The final handoff must distinguish
code changes, automated tests, real-client tests and any independent review.
Never expose ports, change host firewall/socket permissions, add services,
push images, deploy or spawn subagents without explicit authorization. Update
related documentation without erasing historical validation boundaries.

## 11. Document revisions

Use revisions for changes to requirements, assumptions and design decisions, not
for implementation progress. Preserve numbered references where practical and
describe the rationale and security consequences of material changes.

| Revision | Scope |
| --- | --- |
| 1 | Establish the security roadmap, publisher-controlled admission, per-stream encryption selection, authenticated identity/key management, AES-256 media encryption and multi-viewer ciphertext forwarding. |
| 2 | Require E2EE for all streams; remove the transport-only tier and login IP allowlists, scheduled account expiration and login-revocation flags from the target design; distinguish TOFU from independent verification; map requirements to Admin Dashboard pages. |
| 3 | Limit dashboard scope to Users, Rooms and Streams, with current connections/IPs, room membership, publisher/viewer relationships and a small bounded operational log; remove research, validation and documentation pages. |
| 4 | Remove administrator-managed room permissions entirely; make rooms informational and publisher approval authoritative for stream admission; replace LAN product defaults with a public-Internet deployment target. |
| 5 | Connect the implementation steps through a shared flow, explicit dependencies and common protocol/lifecycle contracts; replace preliminary reporting tasks with practical checks and one final task handoff. |
| 6 | Build B implemented sections 2–3 as a concrete wire/account contract in protocol v1 without E2EE: server-generated pending `request_view` IDs decided once by the owning publisher (`view_decision`: approve/deny/block), single-use `approval_id` consumed by `subscribe`, and `remove_viewer` withdrawal; approvals bind stream instance, viewer account and viewer session. Rooms became join/list grouping for any authenticated session; version-1 credential fields (room grants, roles, `expires_at_unix_seconds`, `revoked`, `allowed_ips`) fail closed instead of migrating. Containment is account removal/password reset plus panel policy reload disconnecting all sessions; sessions cap at 600 s. Denial adds a 30 s per-stream cooldown; block refuses future requests and removes that account's viewers. Remembered publisher preapproval and same-call automatic policy (2.7–2.8) remain unimplemented — approval is manual-only for now — and publisher-authenticated E2EE membership (8) is still required before claiming hostile-server resistance. |

## 12. Minimal Admin Dashboard

**Connects to:** the existing accounts (3), publisher/stream membership (2 and 8),
connections (4) and bounded metrics/events (5). Read those same owners' state;
do not build a separate room authority, session model or verification service.

Keep three pages in the existing Rust backend: **Users**, **Rooms** and **Streams**.
Use inline details and a small shared recent-events section instead of additional
security, operations, research or documentation pages. Do not create dashboard UI
for every roadmap requirement; most requirements concern implementation and tests.

### 12.1 Users

- List DASS accounts, display names and online/offline state.
- Show current authenticated connections and their server-observed source IPs.
- Link each connected user to their DASS rooms and publishing/watching activity.
- Keep basic account creation, label editing and password reset simple. Do not
  include login IP allowlists, scheduled account expiry or login-revocation flags.

### 12.2 Rooms

- Show who is together in each DASS room and its active streams.
- Distinguish publishers, viewers and connected room members who are not watching.
- Rooms are a read-only grouping view, with no room permissions, grants or
  block/unblock controls. Session-level stop/disconnect actions belong to Streams.
- Label this as DASS membership, not independently verified Discord call membership.
  Visibility does not grant an administrator permission to watch a stream.

### 12.3 Streams

- Show publisher, DASS room, start time, current viewers and viewer count: who is
  watching whom, without previews or playback in the admin panel.
- Show simple connection state and available ingress/egress bitrate measurements.
- Optionally show bounded pending-view-request counts; approvals stay with the
  publisher. A server-visible E2EE negotiation indicator is not proof that clients
  independently verified identities or that an administrator can decrypt content.
- Keep stop/disconnect actions separate from permission to receive media.

### 12.4 Small operational log

Provide a bounded recent-events section on the existing pages, with timestamps,
severity and short event/reason codes. Include connection/disconnection events,
stream start/stop, failed authentication and operational errors. Use page-local
session references only where needed; do not echo untrusted names into log text.

Do not retain full IPs or account/room activity histories in logs by default.
Show source IPs as live connection details for authenticated administrators only;
discard that association when the connection ends unless a separately reviewed,
explicit retention policy requires otherwise. Bound event counts, response sizes
and retention time. Never include passwords, hashes, credentials, keys, full SDP,
frames or raw signaling payloads. IP display does not imply login IP filtering.

### 12.5 Relevant roadmap links and boundaries

| Roadmap steps | Dashboard surface | Practical purpose |
| --- | --- | --- |
| 2.1–2.4, 2.6–2.10 | Rooms / Streams | Read-only room membership; publisher/viewer relationships, pending counts and stream/session stop controls. No room ACLs. |
| 3.1–3.2 | Users | Basic account management and password reset, without the removed login controls. |
| 4.5, 6.4 | Users → connection details | Current server-observed source IPs, never exposed to other clients. |
| 5.2, 5.5, 8.11 | Streams / recent events | Small connection/bandwidth summaries and bounded operational errors. |
| 6.2, 8.3–8.4, 8.8–8.9 | Streams / recent events | Viewer/session removal and simple connection/rekey failure reasons, without keys or cryptographic internals. |
| Other steps | No dashboard UI required | Research, protocol design, capture consent, identity verification, reviews and tests belong in client UI or external engineering records. |

Publisher approval, QR/safety-number comparison, identity pinning and private/media
keys remain on client devices. The administrator cannot add themselves as an E2EE
recipient or override a publisher's cryptographic membership decision. Protect all
pages with separate admin authentication and all mutations with CSRF protections.
The panel is an operational overview, not a remote shell, deployment interface,
cryptographic control center or substitute for independent client verification.
