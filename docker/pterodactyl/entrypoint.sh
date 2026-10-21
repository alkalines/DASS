#!/bin/bash
set -euo pipefail

# Wings supplies the runtime UID and the writable server mount. Never chown it.
cd /home/container
umask 077
export HOME=/home/container
export TZ="${TZ:-UTC}"
export DASS_DATABASE_FILE="${DASS_DATABASE_FILE:-/home/container/data/dass.sqlite3}"
export DASS_ADMIN_DATA_FILE="${DASS_ADMIN_DATA_FILE:-/home/container/data/policy.json}"
export DASS_LISTEN_ADDR="${DASS_LISTEN_ADDR:-0.0.0.0:${SERVER_PORT:-8080}}"
mkdir -p -- "$(dirname -- "$DASS_DATABASE_FILE")"

# Only translate egg placeholders to shell variable references. Do not eval their
# contents: values such as password hashes must remain data, not shell source.
startup="${STARTUP:-/usr/local/bin/dass-backend}"
placeholder_pattern='\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}'
while [[ "$startup" =~ $placeholder_pattern ]]; do
    placeholder="${BASH_REMATCH[0]}"
    variable_name="${BASH_REMATCH[1]}"
    if [[ ! -v "$variable_name" ]]; then
        printf 'DASS startup variable is not set: %s\n' "$variable_name" >&2
        exit 1
    fi
    startup="${startup//"$placeholder"/\$\{$variable_name\}}"
done
if [[ "$startup" == *'{{'* || "$startup" == *'}}'* ]]; then
    printf 'Invalid DASS startup placeholder.\n' >&2
    exit 1
fi

# STARTUP is trusted egg configuration: use one executable with optional quoted
# arguments, not a pipeline/compound command. Never echo it (it may hold secrets).
printf 'Starting DASS.\n'
exec /bin/bash -u -c "exec $startup"
