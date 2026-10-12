# Direct LAN test setup

Discord Alternative ScreenShare (DASS) will first test direct LAN signaling and
media between publisher/backend `X.X.X.1` and viewer `X.X.X.2`.
Cloudflare is not used. This is an experimental interoperability attempt, not a
working release or a passed transport gate.

## Recorded setup evidence

On October 11, 2026, the user ran `scripts/prepare-lan-test.sh` successfully in
the root Docker shell. Both locked, Docker-run Rust invite issuance commands
completed, and the helper prepared the public certificate without printing
credentials or starting a service. The user subsequently reported completing
the certificate/fingerprint steps on the clients and receiving HTTP 200 from
the capabilities fetch in both actual Equibop renderers after HTTPS startup.
This is user-reported HTTPS/TLS/CORS/reachability evidence; authenticated WSS,
UDP DTLS-SRTP and network media playback remain to be verified.

In a subsequent attempt, the publisher returned a DASS session ID and the viewer
player disappeared after activation. The user transferred the ID using OCR.
No playback was reported, and the cause is not established. An ID returned after
answer application is not evidence of a connected publisher. The client now
provides a selectable ID and Copy button, and retains fixed stage/rejection/close
diagnostics when automatic teardown removes the player. All 81 client tests,
plugin lint, full typecheck and both bundles passed after this change; the retry
and actual UI/clipboard behavior remain unverified.

The user subsequently reported that the two-client stream works. This is the
first user-reported successful real-client media result for the selected
CachyOS/Wayland LAN topology, not an agent-observed recording or a completed
transport gate. The attempt followed the video-only test instructions; selected
audio, exact running revisions/negotiated codecs, Discord voice during network
sharing, network-session teardown, absence of Discord media/preview leakage and
adversarial/reconnection checks still need explicit evidence. Readiness and
advertised media capabilities remain unchanged. Production SFU work remains gated
on completing and recording the required real-client acceptance checks.

After implementing the authenticated directory and viewer, the user additionally
reported working discovery and audio playback on October 11, 2026. See
[watching.md](watching.md) for this follow-up evidence and remaining checks. The
user subsequently confirmed audio consent and backend checks as working. Exact
running revisions, unauthorized access rejection, cleanup and absence of Discord
media leakage remain unverified; remaining runtime tests were deferred.

## 1. Prepare private test material

From the DASS root in the user's root Docker shell (not the desktop/client shell):

```sh
cd /home/arthu/Projects/alkalines-DASS
bash scripts/prepare-lan-test.sh
```

The helper requires Docker Compose, OpenSSL and jq. It creates a two-day
self-signed **server leaf**, not a CA, with an IP SAN for `X.X.X.1`.
It issues two separate one-day credentials for DASS room `lan_test`, using the
Rust admin CLI **inside Docker** with `--locked`. It sets key/invite ownership to
the runtime UID 10001 and never prints credentials. It refuses an existing
`.secrets/lan-test` directory. Failure can leave partial private files; inspect
them rather than deleting unrelated secrets or blindly rerunning.

No services, trust stores, host groups or firewalls are changed by this helper.
Only `build/lan-test-public/cert.pem` is for distribution to both clients; never
copy the server private key. Keep credentials private and scoped to each client.

## 2. Trust the specific server leaf in each client's NSS store

Fully quit Equibop. On each machine, run as the **normal desktop user**, not root.
Put the public certificate at a known path, such as `$HOME/dass-lan-cert.pem`.
Compare its SHA-256 fingerprint with the one printed on the publisher through a
trusted channel before trusting it:

```sh
openssl x509 -in "$HOME/dass-lan-cert.pem" -noout -sha256 -fingerprint
```

Chromium's Linux certificate documentation says that M146+ defaults to
`$HOME/.local/share/pki/nssdb`, but uses an existing `$HOME/.pki/nssdb` instead.
Use the store for the actual Equibop user. Flatpak/sandboxed clients may use a
different home/store; these commands target the native custom host and a native
viewer. Do not claim trust is installed until the actual renderer HTTPS test
below succeeds.

```sh
if [ -f "$HOME/.pki/nssdb/cert9.db" ]; then
    DASS_NSS_DB="$HOME/.pki/nssdb"
else
    DASS_NSS_DB="${XDG_DATA_HOME:-$HOME/.local/share}/pki/nssdb"
fi
mkdir -p "$DASS_NSS_DB"
if [ ! -f "$DASS_NSS_DB/cert9.db" ]; then
    certutil -N --empty-password -d "sql:$DASS_NSS_DB"
fi
if certutil -L -d "sql:$DASS_NSS_DB" -n 'DASS LAN test X.X.X.1' >/dev/null 2>&1; then
    echo 'Test nickname already exists: inspect it before changing trust.'
else
    certutil -A -d "sql:$DASS_NSS_DB" -t 'P,,' \
        -n 'DASS LAN test X.X.X.1' -i "$HOME/dass-lan-cert.pem"
fi
```

`P,,` directly trusts this server leaf; it does not create a broadly trusted CA.
If certutil is unavailable, report that rather than installing host packages or
disabling browser security automatically. Preserve existing database passwords.
If the nickname already exists, inspect it; do not silently overwrite unfamiliar
trust entries. This is an explicit user trust change, not an automatic agent action.

Source: [Chromium Linux certificate management](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md).

## 3. Start and verify authenticated HTTPS before media

In the publisher's root Docker shell, from the DASS root:

Use the single `compose.yaml`, not overlays. Prepare `.secrets/backend.env` and
the `.secrets/runtime` TLS/invite files using
[the invite configuration](control-plane.md#configuration-and-local-tls-testing). For this LAN
signaling test, set the following in `.env`:

```dotenv
DASS_BIND_IP=X.X.X.1
DASS_LAN_SERVER_IPV4=X.X.X.1
DASS_INSECURE_LOCAL_DEV=false
DASS_RTC_SPIKE=false
DASS_RTC_AUTO_LAN_PEERS=false
```

Copy the previously generated `.secrets/lan-test/cert.pem`, `key.pem` and
`invites.json` into `.secrets/runtime`, preserving restrictive permissions and
ensuring container UID/GID `10001:10001` can read them. Replace the example IPs
with the actual backend LAN IP if different.

```sh
docker compose config --quiet
docker compose up -d --build backend
curl --cacert .secrets/lan-test/cert.pem --tlsv1.3 \
    -o /dev/null -w '%{http_code}\n' https://X.X.X.1:8080/health/live
```

Expect liveness HTTP **204**. Readiness remains **503** even during this experiment.
No `curl -k`, `noTLSVerify`, ignored certificate errors or disabled sandbox.
This configuration changes port 8080 from HTTP to HTTPS and publishes it only
on the selected LAN address, not loopback. An existing HTTP Cloudflare origin on that port will stop
working until reconfigured; it is deliberately not part of this LAN test.

The single Compose file retains non-root/read-only/capability-free/resource-bounded
runtime settings. TCP is published only on the selected LAN address.
Publication is not a source-IP firewall: review host/Docker firewall policy and
restrict the LAN listener to these test clients before startup. Do not expose it
on a router, public interface or Tailscale. The helper does not configure firewall
rules. Report a failed step before moving on.

Restart Equibop on both machines. In each actual Discord renderer console, run:

```js
fetch("https://X.X.X.1:8080/v1/capabilities")
    .then(response => ({ status: response.status }))
```

Expect **200** on both. This checks the renderer's TLS/CORS/reachability, not WSS
authentication or media. Do not include credentials in console commands. Record
certificate, CSP, local-network permission or firewall failure without bypassing
browser security. Set the DASS backend URL on both to
`https://X.X.X.1:8080`; leave insecure-local-development disabled.

## 4. Media activation remains the next supervised step

Only after both HTTPS checks succeed, set `DASS_RTC_SPIKE=true` in `.env` and
recreate the backend with the same Compose file. UDP 50000–50001 are already
published on the backend LAN IP but media is disabled until this opt-in. Scope
firewall access to the clients; do not forward ports on the router.

### Default: exact client endpoints

The default policy remains an exact IPv4-and-UDP-port allowlist. Set
`DASS_RTC_ALLOWED_PEERS` to the fresh endpoints shown by both prepared clients
before starting the backend. A changed client port requires updating the list and
recreating the backend before preparing/authenticating peers, as before. Do not
reuse old gathered ports after peers stop.

### Automatic account-based LAN admission (preferred new workflow)

The newer [LAN account setup](lan-accounts.md) uses username/password accounts
with hashed server records and `DASS_RTC_AUTO_LAN_PEERS=true`. It needs neither
client IP lists nor fresh per-stream UDP ports: authenticated candidates must
match the observed WSS LAN peer IP and are admitted only for that RTC session.
Its private account configuration replaces the invite configuration in this older procedure.
The static trusted-IP and exact-port paths below remain explicit alternatives.

### Optional: trusted client IPv4 addresses

To avoid a backend restart for every new Chromium UDP port, explicitly set
`DASS_RTC_TRUSTED_CLIENT_IPS` to the clients' literal IPv4 addresses as seen by
the backend. For example, in the publisher's root Docker shell,
replace the example with the actual client addresses and keep the variable set
for both Compose commands:

```sh
export DASS_RTC_SPIKE=true
export DASS_RTC_TRUSTED_CLIENT_IPS='X.X.X.2'
docker compose config --quiet
docker compose up -d --build backend
```

This is an explicit server-side trust setting: at most 16 comma-separated IPv4
hosts, with no CIDR, wildcard, hostname or IPv6 forms. The backend still rejects
unsafe addresses (including unspecified, multicast, link-local, broadcast,
documentation, benchmarking, shared-CGNAT, metadata and selected reserved
destinations) and candidate ports below 1024. It checks the actual UDP source
address as well as candidates and every outbound destination; client-supplied IP
claims cannot add trusted addresses. Exact endpoints remain
accepted if `DASS_RTC_ALLOWED_PEERS` is also set. With neither setting populated,
startup fails closed; with this option enabled, the exact list may be empty.

Prepare each client normally after this one-time backend configuration. Its
changing non-privileged UDP candidate port no longer requires editing the exact
endpoint list or recreating the backend, provided its actual IPv4 address remains
the same and network/firewall policy permits the UDP path. Changing the trusted
address list does require recreating the backend. This is not a public deployment,
does not bypass firewalls, NAT or OS capture permissions, and does not guarantee
that a direct media path will work.

Use room `lan_test`, with each client receiving only its assigned credential
privately from `.secrets/lan-test/*-credential.txt`. Do not paste those files into
chat, Discord messages, console commands or logs. The manual panel clears
credentials on Stop, failure, expiry and completed activation. Prepare preserves
the typed credential, so it may be entered before or after preparation.
The panel lists missing activation prerequisites beside the disabled button:
prepared peer, room, credential and (for the viewer) publisher session ID.

In exact-endpoint mode, the backend recreation must fit the 180-second peer
preparation deadline. Do not activate authenticated sessions before that
recreation. In trusted-IP mode, configure/recreate once before preparing peers;
routine per-share port changes do not require a restart. The
viewer needs the publisher's returned DASS session ID, not its credential.
Use the Copy session ID button or selectable read-only field, not OCR. Keep the
publisher's settings panel open: closing/unmounting it stops the test. A publisher
without a connected UDP peer can expire at the separate 15-second activation
deadline, regardless of the 180-second preparation window. Check its status
before activating the viewer. The viewer must target a currently active publisher
in the same DASS room; `subscribe:rejected:invalid_state` can indicate a wrong ID
or an absent/ended publisher and is not proof of an OCR mistake.
An applied answer/player spinner is not proof of media or playback. Runtime
capture and cleanup evidence so far is limited to video-only local capture;
selected audio, real media, voice independence during network sharing and
no Discord leakage still need the gate in [transport-gate.md](transport-gate.md).

The agent syntax-checked the shell helper, parsed YAML syntax and ran
`git diff --check`; it has not
run secret issuance, Docker Compose validation/startup, certificate import or
real TLS/browser checks. Rust validation is Docker-only and user-run. No deployment
or host trust/firewall changes were performed by the agent.

After the test, stop the LAN backend and remove **only this test** trust entry
as the desktop user, using the same NSS database:

```sh
certutil -D -d "sql:$DASS_NSS_DB" -n 'DASS LAN test X.X.X.1'
```

Do not delete unrelated certificates or NSS databases. The test certificate and
credentials expire; do not treat this bootstrap as production PKI/authentication.
