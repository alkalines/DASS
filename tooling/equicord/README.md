# Equicord Bun build snapshot

This directory owns the Bun dependency lock used by `scripts/build-plugin.mjs`,
not an Equicord fork or a client runtime helper.

- Upstream source: `https://github.com/Equicord/Equicord.git`
- Revision: `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`
- Validated tooling: Bun 1.4.2, Node 24.18.0, Linux x64.
- Upstream license: GPL-3.0-or-later; local Discord type package: LGPL-3.0-or-later.

The pinned manifest uses a relative `link:` dependency that Bun cannot migrate.
The build adapter changes that one specifier to `file:packages/discord-types`.
The local types retain their upstream package identity, and Equicord's dependency
alias remains `@vencord/discord-types`. No React, Electron or media dependency is
added by DASS. Bun then resolved the upstream ranges intentionally to generate
this lock. It is not an exact reproduction of the upstream pnpm lock graph.
The adapter removes `zip-local`, imported only from Equicord's separate web
build script. This adapter runs only the desktop and Equibop build script. Bun
overrides DOMPurify to 3.4.17 and Moment to 2.31.0, including the Moment
dependency declared by the local type package. These are adapter-only manifest
changes; upstream sources and manifests remain unchanged. Peer warnings may be
reported during resolution.

Normal builds copy this lock into the dedicated checkout and use
`bun install --frozen-lockfile --ignore-scripts`. Dependency lifecycle scripts are
not needed for the validated build. Upstream `pnpm-lock.yaml` is never removed or
edited. Other dependencies for unrelated Equicord plugins remain; DASS does not
invoke external encoders or helpers.

Revision or dependency changes require an intentional update of the build adapter
and this lock, review of changed licenses/native requirements, and repeat lint,
typecheck and bundle validation. Do not regenerate this lock during normal builds.
