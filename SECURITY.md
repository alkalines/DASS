# Security policy

Discord Alternative ScreenShare (DASS) is experimental. No version is currently
approved for an Internet pilot or public multi-user hosting. Automated checks
are not an independent audit. See the [release gates](docs/security-release.md).

## Report a vulnerability privately

Use the repository's **Security → Report a vulnerability** option **if available**.
Do not put exploit details, credentials, private keys, SDP, addresses or stream
contents in public issues. If that option is unavailable, open a content-free
issue asking the maintainer to establish a private reporting channel; send no
sensitive details until a private channel is confirmed.

A monitored private channel, named triage owner and backup have **not been
verified/configured by this change**. The maintainer must publish and test these
before inviting pilot users; this is a release blocker, not an operational SLA.

Include the affected commit/artifact digest, affected component, expected and
observed behavior, and a minimal reproduction using synthetic accounts/media.
Do not send passwords, password hashes, tokens, keys, full signaling traces or
captured content. Agree any further diagnostic collection privately.

## Maintenance and disclosure

Only a specifically reviewed, tested release may acquire a supported scope;
there is no promise that older experimental revisions receive backports.
Before the pilot, the maintainer must accept responsibility for triage and
assign a backup, daily inbox monitoring during the pilot, initial acknowledgement
within two working days and urgent containment of suspected confidentiality or
authorization failures. These are proposed release requirements, not a currently
staffed response guarantee. Agree a coordinated disclosure date with the reporter;
do not promise a fix deadline before understanding the issue.

The [operator runbook](docs/security-release.md#incident-response-and-recovery)
covers containment, notification, rotation and rollback. Never request stream
contents as incident diagnostics. E2EE does not protect compromised clients,
prevent authorized recording, or hide connection metadata from the backend.
