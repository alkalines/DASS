# DASS Pterodactyl image

Discord Alternative ScreenShare (DASS) provides an optional `pterodactyl` image
target following the [Wings custom-image contract](https://docs.pterodactyl.io/v2/guides/egg-creation/creating-custom-image).
It contains the same Rust backend as the standard image, not a second service.
This is image support, **not an importable egg or verified Pterodactyl deployment**.
Public hosting and media interoperability remain experimental; see
[public transport](public-transport.md) before considering exposure.

## Build

For manual GitHub Actions builds of either image or both, with optional GHCR
publication and no release creation, see [on-demand Docker images](images.md).

From the repository root, with Docker daemon access:

```sh
docker build --target pterodactyl -t dass-pterodactyl:local .
```

The shared builder checks Rust formatting, Clippy, locked workspace tests and the
locked release build inside Docker. The default `runtime` image and Compose
service remain unchanged. No host Rust installation is needed.

## Release images

The release workflow publishes `ghcr.io/alkalines/dass:VERSION-pterodactyl`
for both full and backend-only releases (linux/amd64). Substitute a published
version for `VERSION` and add that image to the egg's Docker Images. Releases
include `pterodactyl-image.json` with the image digest for exact pins. The
rolling alias `ghcr.io/alkalines/dass:pterodactyl` points to the same image as the
newest published `VERSION-pterodactyl` tag and advances after release publication.
Use the versioned tag or digest if updates must remain explicitly pinned. The
unsuffixed `latest` and `stable` tags are the standard Docker runtime, **not**
the Wings image. Workflow publication still requires CI acceptance.

For a node-local image, add `~dass-pterodactyl:local` to the egg's Docker Images
(build it on that Wings node). For multiple nodes, tag it with your registry
address and push it yourself, then select that registry tag in the egg. There is
no requirement to publish a locally built image.

## Egg and node configuration

- **Startup command:** `/usr/local/bin/dass-backend`. The binary is inside the
  image, outside the server mount; no binary download/install script is needed.
- **Stop command:** `^C`. The entrypoint uses `exec`, so the backend receives
  SIGINT directly and can drain. Allow at least 10 seconds before forced stop.
- **Primary allocation:** TCP signaling. Wings' `SERVER_PORT` sets the default
  `DASS_LISTEN_ADDR` to `0.0.0.0:PORT`; an explicit `DASS_LISTEN_ADDR` overrides it.
- **Media allocations:** two consecutive UDP ports, starting at
  `DASS_RTC_FIRST_PORT`, when media is enabled. Allocate both in the panel and
  allow them in the node firewall; image `EXPOSE` does not allocate ports.
  Preserve the advertised UDP port numbers through NAT.
- Keep the root filesystem read-only, drop all capabilities, enable
  `no-new-privileges` and set CPU, memory and PID limits in the node/container
  configuration. The Compose reference uses 1 CPU, 256 MiB and 64 PIDs; these
  settings are **not enforced by this image**. No Docker socket mount is needed.

Wings selects the non-root UID/GID. The entrypoint needs neither root nor a
particular UID/name and does not change mount ownership. Wings must supply a
writable `/home/container` mount. The image also has a non-root default user
for manual runs.

## Persistent data and security

All default persistent state is under the Wings server mount:

| Path | Purpose |
| --- | --- |
| `/home/container/data/dass.sqlite3` | SQLite accounts/settings and adjacent journals |
| `/home/container/data/policy.json` | Optional legacy policy import source, not live storage |
| `/home/container/tls/` | Suggested operator-uploaded certificate/key directory |

Back up the data directory using a SQLite-consistent backup procedure or stop
the server first. Preserve file permissions; the entrypoint uses `umask 077` for
new files. Do not override data paths outside `/home/container` if they must
survive recreation. Existing databases retain their stored settings; environment
variables seed only the initial migration. See [SQLite provisioning](sqlite.md).

There is deliberately no automatic plaintext opt-in. Configure both
`DASS_TLS_CERT_FILE=/home/container/tls/fullchain.pem` and
`DASS_TLS_KEY_FILE=/home/container/tls/privkey.pem`, and upload certificates
readable by the Wings runtime UID. Restart after certificate renewal.
Do not set `DASS_INSECURE_LOCAL_DEV=true` on a publicly allocated server.

For the experimental Internet media path also configure:

```text
DASS_TRANSPORT_MODE=public
DASS_RTC_SPIKE=true
DASS_RTC_BIND_IP=0.0.0.0
DASS_RTC_ADVERTISED_IP=<literal public IPv4 of the node>
DASS_RTC_FIRST_PORT=<first of the two allocated UDP ports>
```

Do not enable LAN allowlists in public mode. Direct TLS signaling must preserve
the client's source IP; an ordinary HTTP reverse proxy is unsupported for this
media admission model. Keep initial administration private: new account-mode
databases without imported administrators start with `admin` / `admin` and
require a password change. Configure accounts and resource limits through the
[control panel](control-panel.md); do not expose default credentials publicly.
TLS/SRTP does not provide server-untrusted E2EE.

## Entrypoint behavior and validation

`docker/pterodactyl/entrypoint.sh` switches to `/home/container`, creates the
database parent directory and expands egg `{{NAME}}` placeholders through shell
environment references. Use a single executable with optional arguments; quote
placeholders containing spaces, e.g. `/path/to/program "{{OPTION}}"`. Missing or
malformed placeholders fail startup. `STARTUP` is trusted administrator-controlled
shell configuration, not an input for untrusted users. Variable values are not
re-evaluated as shell code, and the command is not printed to avoid leaking secrets.

The image defaults to UTC unless `TZ` is set. It does not infer a public media
address from the container IP; set `DASS_RTC_ADVERTISED_IP` explicitly.

Run the entrypoint checks locally from the repository root:

```sh
bash -n docker/pterodactyl/entrypoint.sh
bun test ./tests/pterodactyl
```

The image build and real Wings start/stop, mount permissions, TLS, allocations,
backup/restore and real-client media tests still require validation. Docker daemon
access was denied in the implementation session; no image build was performed.
