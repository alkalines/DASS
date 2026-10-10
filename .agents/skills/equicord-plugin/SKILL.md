---
name: equicord-plugin
description: Develop, debug, build or install DASS Equicord userplugins for Discord desktop and Equibop, including plugin lifecycle, webpack patches and Equibop screenshare integration.
---

# Equicord plugin development

## Scope

Use this skill for Equicord plugin work, not OpenCode plugins. Equicord is a
Vencord fork; Equibop is a Vesktop fork that hosts Equicord. Both use the same
plugin definitions, but have different build targets and capture capabilities.

Paths below are relative to the DASS repository root or to an explicitly named
Equicord checkout, not to this skill directory. Read root `AGENTS.md` first.

## 1. Establish the host and revision

- Identify the target: official Discord desktop with Equicord, Equibop, or web.
  Do not assume Equibop native capture/audio APIs exist in other targets.
- `vendor/Equibop` is the pinned host submodule, not an Equicord checkout.
  Do not place plugin source in its renderer patches as an installation method.
- Locate an explicit Equicord source checkout and record its commit plus the
  Equibop/Discord versions used. Do not advance upstream pins incidentally.
- Before prescribing commands, inspect that checkout's `package.json`,
  `scripts/build/common.mjs`, `scripts/build/build.mjs` and `src/utils/types.ts`.
  Upstream `main` is reference material, not a pinned compatibility guarantee.

## 2. Implement a build-time userplugin

- Stage plugin source under `<Equicord>/src/userplugins/dass/index.ts` or
  `index.tsx`, using an explicit copy/staging step rather than a copied host fork.
- Export `definePlugin` from `@utils/types` as the default definition. Keep a
  literal `name` as the first property: build discovery parses this source text.
  Include `description` and real `authors`; do not fabricate author IDs.
- Use host settings APIs and import React/hooks from `@webpack/common`.
  Do not add another React or Electron runtime to the plugin bundle.
- Use `start`/`stop` to own resources. Cancel pending async operations on stop;
  prevent late capture/authentication results from resurrecting a stopped session.
  Stop tracks, close peer connections and remove listeners/workers deterministically.
- Keep Discord module discovery and private hooks in an adapter. Guard ambiguous
  matches and disable the affected integration visibly rather than guessing.
- Plugin `patches` modify Discord webpack module source; they are not a general
  patch mechanism for Equibop's own bundled renderer. Patches normally require a
  restart. Do not treat `stop()` as undoing already-applied source patches.
- Check upstream target filtering before using platform-specific filename suffixes.
  Gate host-specific behavior without disabling otherwise supported targets.

## 3. Integrate DASS capture in Equibop

Trace these files in `vendor/Equibop` before changing capture behavior:

- `src/main/screenShare.ts`: Electron display-media handler and picker dispatch.
- `src/renderer/components/ScreenSharePicker.tsx`: source/quality/audio selection.
- `src/renderer/patches/screenShareFixes.ts`: installed Linux `getDisplayMedia`
  wrapper, constraints and venmic audio attachment.
- `src/main/venmic.ts`: existing in-process audio integration.

Integrate at this existing capture path and intercept the selected Discord share
action before native stream creation. Preserve consent and visible capture state;
call the installed capture function instead of an unpatched copy. If a necessary
hook is absent, identify the narrow host change separately from the userplugin.
Do not claim an Equicord webpack patch can automatically patch host renderer code.

Use Chromium WebRTC encoding/decoding and existing venmic. No DASS client child
process, executable, proxy, external encoder/decoder, FFmpeg or GStreamer.
Audio inclusion must follow explicit user selection, never implicit microphone
capture. Never send DASS frames or preview thumbnails through Discord as fallback.

## 4. Build and install the correct target

In the **Equicord checkout**, the currently inspected upstream workflow is:

```sh
pnpm install --frozen-lockfile
pnpm build
```

- Custom plugins require building Equicord from source; copying a loose plugin
  into an installed client does not install it. Rebuild after source changes.
- Official Discord desktop: `pnpm inject` installs the custom build. Run only
  when installation is authorized, not as part of a routine verification step.
- Equibop: select `<Equicord>/dist` as the custom Equicord location, **not**
  `dist/equibop`. The host appends `equibop` and validates `equibop/main.js`.
  See host `src/main/vencordDir.ts` and `src/main/ipc.ts`. Do not inject into it.
- The inspected build emits both `dist/desktop` and `dist/equibop`; verify the
  pinned scripts and artifact presence before documenting a successful install.

## 5. Verify without overstating results

- In the Equicord checkout, use `pnpm lint src/userplugins/dass`,
  `pnpm testTsc` and `pnpm build`, after verifying the pinned manifest.
  Upstream `pnpm test` includes `lint:fix` and metadata generation: it is not a
  read-only test command. Review resulting changes if it is used.
- Equibop's `bun run test` is host lint/typechecking, not DASS media testing.
- Exercise Wayland/X11 picker selection and cancellation, optional audio,
  simultaneous Discord voice, and stop/disable/logout during pending capture.
- Verify interception precedes native share creation and that no DASS media or
  thumbnails reach Discord. Test hook mismatch, authentication failure and
  required-E2EE rejection; never log tokens, keys or full SDP as diagnostics.
- Report pinned builds, commands actually run and untested runtime/security
  behavior. Build success alone does not establish interception, capture or audio.

## Upstream references

- [Equicord README](https://github.com/Equicord/Equicord/blob/main/README.md)
- [Plugin discovery](https://github.com/Equicord/Equicord/blob/main/scripts/build/common.mjs)
- [Desktop/Equibop builds](https://github.com/Equicord/Equicord/blob/main/scripts/build/build.mjs)
- [Plugin definitions](https://github.com/Equicord/Equicord/blob/main/src/utils/types.ts)

Recheck these against the selected commit; do not execute downloaded scripts.
