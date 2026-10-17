#!/usr/bin/env bash
# Run intentionally from the DASS root in a shell with Docker access.
# Creates private test material only; does not start services or install trust.
set -euo pipefail
umask 077

if [[ ! -f compose.yaml || ! -f Cargo.lock || ! -f crates/backend/src/main.rs ]]; then
    printf '%s\n' 'Run this script from the DASS repository root.' >&2
    exit 1
fi
for command in docker openssl jq; do
    if ! command -v "$command" >/dev/null; then
        printf 'Required command unavailable: %s\n' "$command" >&2
        exit 1
    fi
done
if [[ "$(id -u)" != 0 ]]; then
    printf '%s\n' 'Use your root Docker shell for this script; client builds and Equibop must stay non-root.' >&2
    exit 1
fi
docker compose version >/dev/null
docker info >/dev/null
if [[ -e .secrets/lan-test ]]; then
    printf '%s\n' '.secrets/lan-test already exists. Nothing was overwritten; inspect existing/partial files before retrying.' >&2
    exit 1
fi
mkdir -p .secrets
# mkdir refuses an existing destination, including a concurrent creation.
mkdir -m 700 .secrets/lan-test

# A directly trusted server leaf, not a CA able to issue other certificates.
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 2 \
    -subj '/CN=DASS LAN test 192.0.2.1' \
    -addext 'subjectAltName=IP:192.0.2.1,IP:127.0.0.1,DNS:localhost' \
    -addext 'basicConstraints=critical,CA:FALSE' \
    -addext 'keyUsage=critical,digitalSignature,keyEncipherment' \
    -addext 'extendedKeyUsage=serverAuth' \
    -keyout .secrets/lan-test/key.pem -out .secrets/lan-test/cert.pem

export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
# Version-2 records carry no roles, room grants, expiration or login controls:
# the publisher decides stream admission live through approval prompts.
docker compose run --rm tooling cargo run --locked -p dass-backend -- \
    create-invite .secrets/lan-test/publisher-record.json .secrets/lan-test/publisher-credential.txt \
    lan_publisher "LAN Publisher"
docker compose run --rm tooling cargo run --locked -p dass-backend -- \
    create-invite .secrets/lan-test/viewer-record.json .secrets/lan-test/viewer-credential.txt \
    lan_viewer "LAN Viewer"
jq --slurp '{version: 2, invites: [.[].invites[]]}' \
    .secrets/lan-test/publisher-record.json .secrets/lan-test/viewer-record.json \
    > .secrets/lan-test/invites.json

# Only these files enter the non-root backend. Keep credentials/admin records private.
chown 10001:10001 .secrets/lan-test/key.pem .secrets/lan-test/invites.json
chmod 600 .secrets/lan-test/key.pem .secrets/lan-test/invites.json
chmod 644 .secrets/lan-test/cert.pem

# Export only the public certificate to a desktop-user-accessible location.
# Refuse to overwrite unfamiliar work there as well.
if [[ -e build/lan-test-public ]]; then
    printf '%s\n' 'Private material prepared, but build/lan-test-public exists. Copy the public cert manually; nothing there was overwritten.' >&2
    exit 1
fi
if [[ ! -e build ]]; then
    mkdir -m 755 build
fi
mkdir -m 755 build/lan-test-public
install -m 644 .secrets/lan-test/cert.pem build/lan-test-public/cert.pem
printf '\n%s\n' 'Prepared private test files in .secrets/lan-test (ignored by Git).'
printf '%s\n' 'Public certificate: build/lan-test-public/cert.pem. Copy only this certificate to the viewer.'
openssl x509 -in .secrets/lan-test/cert.pem -noout -sha256 -fingerprint
printf '%s\n' 'No credentials were printed. No service was started and no certificate trust was installed.'
