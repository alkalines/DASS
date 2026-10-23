# DASS administrator logs

Discord Alternative ScreenShare (DASS) provides a small **Logs** page at
`/admin/logs`, protected by the existing administrator login. It shows JSON lines
from the Rust backend and connected DASS clients. Filter by server/client, pause
refreshing while investigating, then use **Copy JSON lines** to share the selected
entries. Clipboard failures select the text for manual copying.

- The latest 512 entries are held in memory, oldest first. Restarting the backend
  clears them; there is no database history or file-log ingestion.
- `time` is the event's UTC timestamp; `received_time` is backend receipt time.
  Client clocks can differ. Entries are in receipt order, not globally clock-sorted.
- Each client runtime has a random `client_id`, visible in the DASS plugin settings
  as **Admin log client**. This distinguishes two clients without recording account,
  Discord, device or room identifiers. The label changes on client restart/reload.
- `connection` is assigned by the backend and correlates client entries with the
  server tracing span's `details.connection`. Client labels, timestamps and reports
  are self-reported diagnostics, never identity or authorization evidence.
- Clients send existing DASS diagnostic events over their authenticated WSS
  connection in best-effort batches (up to four entries per two-second flush,
  plus a best-effort final flush when closing).
  Their local queue holds at most 64 entries and drops the oldest on overflow.
  One connection collects per client runtime, avoiding duplicate reports from
  parallel publisher/viewer connections. No additional connection/process is used.
- Only known event names, numeric counters, flags and allowlisted state/code
  strings are retained. Unknown fields are removed and unknown label values become
  `other`. Raw console messages, exceptions/stacks, credentials, keys, SDP, network
  addresses, captured frames and media payloads are not collected.
- Pre-login failures, offline events and any unsent teardown events remain local;
  this view is not a complete replacement for local client or container logs.

Rebuild **both** backend and custom Equicord plugin from this revision; old clients
do not upload diagnostics and old backends do not understand diagnostic batches.
From the repository root, use `docker compose build backend` for backend checks
and `bun scripts/build-plugin.mjs` for plugin checks/bundles. Installation remains
an explicit step: see [plugin.md](plugin.md). No injection/deployment is performed
by these checks. Live two-client acceptance is still required; this feature does
not change production-readiness or E2EE claims.
