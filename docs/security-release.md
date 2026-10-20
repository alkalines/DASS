# Security release gates and maintenance

Discord Alternative ScreenShare (DASS) follows security roadmap order F:
section 7's limited E2EE Internet pilot **before** section 9's public hosting.
Neither gate has passed. This guide supplies repeatable checks and operator
procedures, not deployment permission or an independent security review.

## Blocking findings from the assembled implementation

Keep these open until fixes and retests are independently reviewed. The source
inspection here is an AI-assisted review, **not an audit** or an exhaustive list.

| Finding | Evidence / required resolution |
| --- | --- |
| Unreviewed media cryptography and sender/track binding | `clients/spike/e2ee.ts` implements a project-specific SFrame-shaped format, not RFC 9605. The same epoch key and frame-cipher context are installed on every audio/video transform for a peer; the authenticated frame header contains only epoch and counter, not an authenticated sender/track context. The shared counter avoids local nonce collision between those transforms, but does not establish sender or track identity. There are no published DASS vectors or independent cryptographic review. Keep Internet-pilot and confidentiality claims blocked. |
| Worker epoch lifecycle and media-context binding | The previous `workerBootstrap` could replace an epoch's replay state and reset a live send counter on duplicate or out-of-order asynchronous installs. The worker now serializes installs and retirement, treats a byte-identical install as idempotent, rejects conflicting same-epoch keys, advances sender epoch state monotonically, shares the per-epoch send counter/replay window across attached audio/video transform ports, and keeps encrypt/decrypt role local to each transform. Isolated worker event/stream tests exercise duplicate installs after traffic, counter continuity across sender transforms and rekey ordering, conflicting-key rejection, queued retirement versus stale installation, and replay rejection across receiver transforms. **This repairs the identified local lifecycle race only; it does not establish sender/track cryptographic binding.** The project-specific frame format still has no independent crypto review or published vectors; protocol-level sender/track separation, membership and malicious-signaling validation remain pilot blockers. |
| Recipient keys are selected by mutable account state | **Client-side race fixes implemented; independent review/retest still required.** Request/device keys are snapshotted by request ID, duplicate IDs cannot replace them, and view decisions are serialized. Account membership generations invalidate outstanding requests on deny/block/removal; late trust results and request-closed events remove pending state. Delivery and rekey bind to an immutable membership token/key and recheck it after async wrapping and relay; identity confirm/verify actions address one request. Request-key state is bounded to 16 entries and cleared on trust-read failure, decision failure or closure. Deferred-promise tests exercise same-account competing devices and withdrawal during approval; generated ECDH identities verify a relayed blob unwraps only for the approved device, and a removed identity cannot unwrap a replacement device's epoch blob. Tests also verify closed requests cannot be approved and unconfirmed removal stops publishing fail-closed. **Not established:** authenticity of malicious backend events, rollback-safe persistent pin writes, cancellation of a relay already in flight before withdrawal, account-to-device uniqueness, or admission-history isolation below. |
| Admission-history isolation | A newly approved viewer triggers a fresh epoch; the publisher snapshots the approved one-device-per-account roster, wraps the fresh key only for those exact members, checks membership after asynchronous wrapping and each relay, and fails publishing closed if wrapping or relay fails. The send epoch is committed only after all wraps complete; publishing startup with no viewers does not install an epoch. Removal invalidates that member before the serialized removal/rekey operation, excluding it from future distribution. Generated ECDH identity tests record a frame under the prior key and confirm the newly admitted identity cannot decrypt it while existing approved identities unwrap the new epoch. A controlled deferred-wrap test removes a joining viewer before wrap completion and confirms no key is relayed to that viewer and the send epoch advances monotonically for the remaining member. These are client unit-test results, not independent cryptographic review or browser/media acceptance. Previously authorized recipients may record or share plaintext/ciphertext while authorized; rekeying cannot retract it. |
| Internet, client and overload acceptance missing | The public observed-peer policy, real Equibop capture/consent/leakage checks, NAT/loss/reconnect behavior and resource ceilings need measured end-to-end evidence. Existing user-confirmed LAN behavior predates these security changes. |
| Capacity is a feasibility topology | `MediaHub` in `crates/backend/src/forwarding.rs` owns one global publisher and one viewer. Configurable session counts do not implement multi-publisher/multi-viewer forwarding or account/source fairness. Do not raise limits or advertise public multi-user support. |

The replay bitmap previously retained arbitrarily long history and could shift by
a 64-bit counter jump. Order F bounds it to 256 bits, rejects out-of-range counters
and rejects frame integer truncation before nonce construction. These local fixes
are regression-tested, not a validation of the surrounding encryption protocol.

### E2EE implementation choice (open; no migration claimed)

The source and deployment constraints do not currently support a safe drop-in
replacement. The pinned clients use Chromium encoded-frame transforms, while the
project frame cipher and signaling key distribution are separate mechanisms. No
maintained, reviewed JavaScript implementation with documented compatibility for
the pinned Chromium/Equibop builds, the required AES-256 suite, one-upload
ciphertext forwarding, interoperable vectors, and a suitable authenticated
membership/key-management story has been verified for this repository. Do not
interpret the absence of a selected package as evidence that none exists.

RFC 9605 is the interoperable framing specification and includes test vectors,
but it explicitly leaves key management to the application (Sections 5 and 9),
requires a key to be used for encryption by exactly one sender (Section 4.4.1),
and does not authenticate the sender of media (Section 7.2). Adopting SFrame
alone therefore does not repair DASS sender/track binding or membership trust.
The current frame transform is not RFC 9605: it has no SFrame KID/header encoding
or RFC 9605 cipher-suite derivation, and matching a nonce construction is not
interoperability. The W3C encoded-transform API supplies a transform hook, not a
cryptographic protocol or key-management implementation.

Before selecting a replacement, a qualified crypto/media maintainer must decide
and document (1) the pinned client/Chromium compatibility target and maintained
implementation, (2) a published-vector test plan and exact mandatory suite, (3)
unique cryptographic sender and track contexts that are authenticated and cannot
be reassigned by signaling, (4) authenticated membership, join/removal rekey and
malicious-signaling behavior, and (5) nonce/key-usage bounds, replay handling,
and failure behavior. Any design must preserve the backend's one-upload,
unchanged-ciphertext fan-out and keep media keys off the backend. Obtain
independent expert review and real pinned-client interoperability evidence before
changing the gate or making confidentiality claims. Until then the existing
experimental transform is not an approved secure implementation; do not weaken
mandatory E2EE or add a plaintext fallback.

Primary specifications: [RFC 9605](https://www.rfc-editor.org/rfc/rfc9605.html)
(notably §§4.4.1, 5, 7.2, 9 and Appendix C) and the
[W3C WebRTC Encoded Transform specification](https://www.w3.org/TR/webrtc-encoded-transform/).

## Repeatable automated checks

Run from the **repository root**, without starting the backend:

```sh
bun scripts/generate-protocol.mjs --check
bun test ./tests/plugin ./tests/admin
bun scripts/build-plugin.mjs
docker compose build backend
```

The Docker build checks Rust formatting, Clippy with denied warnings, locked
workspace tests and a locked release build. No host Cargo fallback. Ask the
operator to run it when the agent cannot access Docker. Never change socket
permissions. The plugin build uses the pinned checkout, frozen Bun lockfile and
script-free installation; it does not inject/install into a running client.

Client security regressions include missing/mistyped fields, authority injection,
bounded malformed-input mutations, identity substitution/context mismatch,
tampering, replay, frame/key size bounds and generated-worker isolated scope.
The deterministic client parser corpus is **not** coverage-guided Rust protocol
fuzzing, hostile WSS/RTC integration, browser media acceptance or a crypto audit.
Run coverage-guided backend parser/SDP/ICE fuzzing in Docker and retain minimized
synthetic reproducers before closing 7.1; no fuzz campaign is claimed here.

Validation on 2026-10-20 (Bun 1.4.3, Node v24.18.0): protocol freshness passed;
311 client/admin tests passed, including admission-history isolation and deferred
membership rekey coverage; the plugin adapter passed lint, full typecheck and
desktop/Equibop builds. Provenance collection correctly returned nonzero for the
working tree with these uncommitted edits and confirmed both clean upstream pins.
The staged module was additionally bundled with the checkout's esbuild and its
generated worker evaluated in an isolated scope: frame round-trip, maximum counter
jump/replay rejection and epoch-range rejection passed. This does not exercise
real-browser `RTCRtpScriptTransform` interoperability or actual client audio/video
behavior. The local worker event/stream harness exercises the duplicate-install
multi-port lifecycle regression but is not browser acceptance. These checks do
not constitute independent review of the project-specific cryptographic protocol;
sender/track cryptographic binding remains unresolved.
The agent's Docker build attempt failed with socket permission denied. The operator
subsequently supplied a successful `docker compose build backend` result, producing
image `0607280a5e17` (`alkalines-dass-backend:latest`). Formatting, denied-warning
Clippy, locked workspace tests and the locked release build were satisfied through
cached Docker layers, not freshly executed in that invocation; no test count was
shown. The missing-buildx warning was non-blocking: the classic builder completed.
This is operator-reported backend build evidence, not client/E2EE validation. No
real-client Internet test, independent review, deployment, recovery drill or capacity
measurement ran as part of this task.

### Dependency review and build provenance

From **`build/Equicord`**, after the pinned adapter has prepared it:

```sh
bun audit --json
```

This sends the lockfile's dependency inventory to the registry advisory service.
Do not run `audit fix` or update dependencies/pins as a routine check. Audit the
Equibop/native/Electron inventory separately, including the shipped Electron
version rather than just the JavaScript wrappers. Audit Rust's committed
`Cargo.lock` in Docker using a deliberately pinned/reviewed cargo-audit tool and
current RustSec database; no scanner is installed automatically and no Rust
advisory review is claimed until its output/database revision is recorded.
Record advisory IDs, affected paths, exploitability, fix/mitigation, reviewer and
retest; a failed/unavailable scan is not a clean result. Review licenses and
native requirements too. No blanket advisory suppression.

The 2026-10-20 `bun audit --json` run in `build/Equicord` exited **1** and
reported the following packages. This is registry advisory evidence plus initial
source-path triage, not proof that a shipped DASS path is exploitable or exempt.
All findings remain open for maintainer review and retest; no lockfile or upstream
pin was changed and no advisory was suppressed.

| Locked dependency / path | Registry result and initial scope |
| --- | --- |
| `braces@3.0.3` ← `micromatch` ← build/lint globbing | High: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack-exhaustion DoS. Review build-input handling and a compatible patched dependency resolution. |
| `dompurify@3.2.7` ← `monaco-editor@0.55.1` | Multiple moderate/low XSS/sanitization advisories, including [GHSA-v2wj-7wpq-c8vv](https://github.com/advisories/GHSA-v2wj-7wpq-c8vv) and [GHSA-hpcv-96wg-7vj8](https://github.com/advisories/GHSA-hpcv-96wg-7vj8). Upstream `browser/monaco.ts` imports Monaco. Establish desktop/Equibop bundle reachability and sanitization options; do not infer safety from DASS not importing it directly. Retain the full audit output privately with release evidence. |
| `jszip@2.7.0` ← `zip-local@0.3.5` | Moderate: [GHSA-36fh-84j7-cv5h](https://github.com/advisories/GHSA-36fh-84j7-cv5h), path traversal. Upstream `scripts/build/buildWeb.mjs` imports `zip-local`; the DASS adapter builds desktop/Equibop, not web. Reachability/exclusion still needs maintainer confirmation. |
| `moment@2.22.2` declared by local `@equicord/discord-types` | High: [GHSA-8hfj-j24r-96c4](https://github.com/advisories/GHSA-8hfj-j24r-96c4) and [GHSA-wc69-rhjr-hc9g](https://github.com/advisories/GHSA-wc69-rhjr-hc9g). The lock also resolves top-level `moment@2.31.0`; the local types package imports `Moment` in a `.d.ts`. Verify installed resolution/runtime bundle before deciding applicability. |

Rust, Electron, Equibop/native and container-image advisory/license review are
still unperformed. Dependency remediation must be an intentional reviewed update
with new frozen-lock validation, not an incidental pin advance during this task.

From the **repository root**:

```sh
bun scripts/release-provenance.mjs
```

This prints only commit, clean-tree status, pinned submodule revisions, tool
versions and selected input SHA-256 hashes. It exits nonzero for dirty/unpinned
sources. It does not read secrets, sign artifacts, establish reproducibility,
check advisories or approve deployment. Save release evidence outside the source
tree so it does not itself dirty the checkout. For an actual release also record:

- Exact build commands, OS/architecture, Docker builder/runtime base image digests,
  resolved dependency inventory, backend image digest and each shipped bundle hash.
  Base image tags currently are not immutable digest pins: review/pin them before
  release, never substitute guessed digests.
- Independent reviewer and operator identities and their authenticated approvals
  binding this exact source/artifact set, deployment topology and capacity.
- A maintainer-authenticated signature/attestation verified through an independently
  trusted release key/channel before installing. Hashes served alongside artifacts
  alone do not authenticate them. Artifact signing/update delivery remains open;
  do not add runtime executable downloads to the plugin.

Review advisories weekly and immediately for relevant alerts; repeat scans, license
review and all acceptance checks on each release and dependency/host change. Assign
named maintainer and backup before the pilot; review the threat model at least
quarterly. These are required responsibilities, not evidence of a staffed service.

## Gate 7: limited Internet pilot

Keep a single release evidence record with the following fields. A missing,
blocked, stale or failed item means **no-go**; passing automation alone is no-go.
Do not put user addresses, credentials or content in the record.

1. **Scope and provenance:** exact source/artifact digests, clean pins/lockfiles,
   Equicord/Equibop/Electron/Discord builds, OS/display server, server hardware,
   transport/address families and the narrowly evaluated one-publisher/one-viewer
   topology (two media sessions maximum). No unsupported fallback claims.
2. **Dependencies 1–6 and 8:** findings resolved/retested, negative integration and
   fuzz results, crypto protocol review/vectors, identity trust/pin/recovery policy,
   stored-secret failure tests, private administration and trusted certificate
   renewal/expiry checks. Record reviewer, date, report reference and exclusions.
3. **Independent review:** named qualified reviewer independent of implementation,
   covering auth, approvals/key binding, crypto/membership, RTC destinations,
   deployment/abuse limits and capture cleanup. Track severity, fix revision and
   retest for each finding. Critical/high findings block the pilot. AI self-tests
   do not satisfy this item.
4. **Operator authorization:** named operator, date, approved artifacts/topology,
   invited users only, private/restricted administration, monitoring owner, stop
   criteria and rollback target. Explicitly accept residual TOFU first-contact,
   metadata, recording, endpoint compromise and availability risks. This task and
   the roadmap do not supply that authorization.
5. **Acceptance record:** run the matrix below on authorized test infrastructure,
   record result, date, build/scenario, measured bounds and synthetic evidence per
   row. A blank row is not a pass. No unrestricted signup.

| Scenario | Required observable outcome |
| --- | --- |
| Two clients on separate Internet networks | Approved encrypted video and explicit share audio; no plaintext startup/fallback; ordinary Discord voice unaffected. |
| IPv4/IPv6, home/CGNAT, restrictive UDP, split signaling/media egress | Supported cases measured; unsupported paths fail closed, no participant IP/candidate disclosure, P2P or unapproved TURN. |
| Loss, reordering, reconnect, expired session and backend crash/restart | Auth/current approval restored explicitly; stale keys/tickets/approvals refused; no silently restarted capture or leaked resources. |
| Forged/cross-account/cross-stream approvals, direct subscribe, key replacement and same-call claims | No route/key release to unapproved or unpinned recipient; UI-only policy is insufficient. |
| Removal/block/stop/reset concurrent with queued output and rekey | Record maximum server route/output cutoff and client last-decryptable-frame delay under load; no new-epoch key for removed viewers. No bound is claimed until measured. |
| Picker cancellation/source end/logout/disable/context exit/partial setup | Tracks, audio links, peers, workers, listeners and UDP admission released; repeat teardown and cancel during pending setup. |
| Scoped network leakage inspection on each supported build/OS | No DASS media/preview upload to Discord, including hook mismatch and reconnect; only server-relayed ciphertext. |
| Slow readers, churn, malformed/oversized messages, hash/handshake/UDP floods | Measured peak CPU/RSS, queue depths, ingress/egress and recovery stay within approved limits; unrelated accounts retain fair access. Provider DDoS/link-saturation risk disclosed. |
| Certificate expiry/renewal, keyring locked/unavailable and origin change | No insecure/cleartext fallback or silently inherited trust; documented recovery works. |
| Backup/restore and rollback with removed account/viewer | No old account credentials, approval, verified pin or revoked recipient access resurrected. |

Monitor bounded aggregate connection/login/rejection/media counters, rate-limit
events, resource use and certificate expiry; never log content, keys or SDP. Keep
live IP details restricted to authenticated admins and discard on disconnect.
Any unexplained recipient/key change, plaintext/leakage indication, failed
removal, resource ceiling breach or missing monitoring stops the pilot. Escalate
to the incident owner; resume only after investigation, retest and renewed
operator approval. Record incidents and measured capacity, not performance guesses.

## Gate 9: public multi-user hosting

Gate 7 evidence and approval must exist first. Gate 9 stays closed with the
current global one-publisher/one-viewer hub. Do not implement scale by increasing
environment limits alone. A separately reviewed forwarding change must preserve
one publisher upload per layer and identical ciphertext copies per viewer, with
per-viewer authenticated key distribution and measured admission/removal behavior.

Before expansion, record independent isolation/load review and acceptance for:
multiple simultaneous accounts/streams, cross-stream guessing/replay, reconnect
and restart races, slow viewers, per-account/source fairness and prompt abuse,
account lifecycle, private abuse reports, and failure under realistic measured
bitrate/packet/CPU/memory/egress budgets. Re-run the pilot matrix at the proposed
capacity. Define conservative limits from measurements, not constants. Record
maintenance/incident owners, tested private reporting, authenticated artifacts,
and an operator-approved expansion/rollback plan. Topology, trust-policy or
capacity changes invalidate the corresponding earlier evidence.

Release claims must distinguish reviewed/tested behavior from experiments. Never
call DTLS-SRTP alone E2EE, imply verified first contact from TOFU, claim a server
cannot read content before independent crypto review, or advertise unsupported
clients/networks. Keep readiness/capabilities fail-closed until their actual
advertised functions pass acceptance. No approval flag in this document changes
the backend's capabilities or authorizes exposing ports.

## Incident response and recovery

Before the pilot, assign a primary incident operator and backup, private reporting
channel and notification channel. Practice this procedure with synthetic accounts
on isolated infrastructure and retain sanitized results; it has **not** been
drilled by this task.

1. **Triage:** record time, affected digests/component, severity and a minimized
   synthetic reproduction. Treat suspected confidentiality/recipient failures as
   urgent. Keep only bounded fixed-code events and aggregate metrics; no frames,
   keys, passwords/hashes, full SDP or raw signaling dumps. Agree private access
   and deletion after triage (target seven days for temporary diagnostics unless
   explicitly justified); never retain connection/IP history by default.
2. **Contain:** operator stops affected streams/sessions using Streams; if scope
   is uncertain, stop the DASS service and keep it unavailable. A session kick
   alone does not prevent login. Remove a compromised DASS account or reset its
   password in the authoritative policy; policy reload closes all sessions.
   Do not introduce login revocation flags, expiry, IP lists or room grants.
3. **Rotate:** provision new separate client/admin credentials through the trusted
   private path; recreate only under operator authority for environment-held admin
   credentials/TLS keys. Password reset must not replace a verified E2EE identity.
   Suspected device-key compromise requires stream stop, local device-key recovery,
   explicit out-of-band reverification and fresh stream epochs for all affected
   peers. Static ECDH wrapping does not establish forward secrecy: previously
   recorded key relays may be at risk after identity-key compromise. Rotation
   cannot retract already received material or recordings.
4. **Recover policy safely:** encrypted, access-controlled backups contain password
   hashes and possibly stale account policy. Preserve the latest removals/resets
   separately with access controls before restore. Restore offline, reconcile
   against those changes, and do not seed from stale environment accounts or delete
   the durable volume to reset it. Do not restore live sessions/approvals. Client
   backups must not resurrect removed preapprovals, verified old pins or old keys.
5. **Patch/rollback:** choose a reviewed artifact digest compatible with the current
   policy schema and mandatory E2EE. Never roll back into removed grants or weaker
   encryption/authentication. If no safe compatible artifact exists, remain stopped.
   Re-run regressions and removal/reconnect/restore acceptance before operator-led
   restart; fresh publisher approvals and required reverification remain necessary.
6. **Notify and learn:** privately notify affected users of evaluated scope,
   metadata/content exposure uncertainty, required credential/key actions and
   known limits. Coordinate public advisory/patch release without publishing secrets.
   Record timeline, containment, fix/retest evidence and follow-up owners. Repeat
   the drill before expansion and after recovery/persistence changes.

Reporting setup and response expectations are in [SECURITY.md](../SECURITY.md).
