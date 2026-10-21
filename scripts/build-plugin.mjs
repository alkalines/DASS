import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { adaptEquicordManifest } from "./equicordManifest.mjs";
import { parseVersion } from "./release-plan.mjs";

const EQUICORD_REVISION = "e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4";
const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const vendorDirectory = join(rootDirectory, "vendor/Equicord");
const checkoutDirectory = join(rootDirectory, "build/Equicord");

function run(command, args, directory = checkoutDirectory, capture = false) {
    const result = spawnSync(command, args, {
        cwd: directory,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit"
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
    return result.stdout?.trim();
}

function digest(contents) {
    return createHash("sha256").update(contents).digest("hex");
}

try {
    //const bunVersion = run("bun", ["--version"], rootDirectory, true);
    //if (bunVersion !== "1.4.2") throw new Error(`This build is validated with Bun 1.4.2, not ${bunVersion}.`);
    if (Number(run("node", ["--version"], rootDirectory, true).slice(1).split(".")[0]) < 22) {
        throw new Error("Equicord requires Node >=22 for its build script.");
    }

    if (!existsSync(join(vendorDirectory, "package.json"))) {
        throw new Error("Initialize vendor/Equicord with git submodule update --init --recursive before building.");
    }
    if (run("git", ["rev-parse", "HEAD"], vendorDirectory, true) !== EQUICORD_REVISION) {
        throw new Error("vendor/Equicord has a different revision. The build requires the reviewed Equicord pin.");
    }
    if (!existsSync(checkoutDirectory)) {
        mkdirSync(join(rootDirectory, "build"), { recursive: true });
        run("git", ["clone", "--no-hardlinks", "--no-checkout", vendorDirectory, checkoutDirectory], rootDirectory);
        run("git", ["switch", "--detach", EQUICORD_REVISION]);
    }
    if (run("git", ["rev-parse", "HEAD"], checkoutDirectory, true) !== EQUICORD_REVISION) {
        throw new Error("build/Equicord has a different revision. Use a dedicated pinned checkout; no files were reset.");
    }
    const changedFiles = run("git", ["diff", "--name-only", "HEAD"], checkoutDirectory, true);
    if (changedFiles.split("\n").some(path => path && path !== "package.json")) {
        throw new Error("build/Equicord contains unrelated tracked changes; refusing to build or overwrite them.");
    }

    const upstreamManifest = spawnSync("git", ["show", `${EQUICORD_REVISION}:package.json`], {
        cwd: checkoutDirectory, encoding: "utf8"
    });
    if (upstreamManifest.status !== 0) throw new Error("Cannot read pinned Equicord manifest.");
    const originalManifest = upstreamManifest.stdout;
    const previousAdapterManifest = originalManifest.replace('"link:packages/discord-types"', '"file:packages/discord-types"');
    const adaptedManifest = adaptEquicordManifest(originalManifest);
    const manifestPath = join(checkoutDirectory, "package.json");
    const currentManifest = readFileSync(manifestPath, "utf8");
    if (currentManifest !== originalManifest && currentManifest !== previousAdapterManifest && currentManifest !== adaptedManifest) {
        throw new Error("Equicord package.json has user changes; refusing to overwrite it.");
    }

    const lockContents = readFileSync(join(rootDirectory, "tooling/equicord/bun.lock"));
    const lockPath = join(checkoutDirectory, "bun.lock");
    if (existsSync(lockPath) && !readFileSync(lockPath).equals(lockContents)) {
        throw new Error("Equicord bun.lock differs from the reviewed build lock; refusing to overwrite it.");
    }

    const sourceDirectory = join(rootDirectory, "plugins/dass");
    const stagedDirectory = join(checkoutDirectory, "src/userplugins/dass");
    const markerPath = join(checkoutDirectory, ".dass-staged.json");
    const previousHashes = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, "utf8")) : {};
    const sources = new Map(readdirSync(sourceDirectory).map(name => [name, readFileSync(join(sourceDirectory, name), "utf8")
        .replaceAll('"../../clients/spike/peer"', '"./spikePeer"')
        .replaceAll('"../../clients/spike/signaling"', '"./spikeSignaling"')
        .replaceAll('"../../clients/spike/diagnostics"', '"./diagnostics"')
        .replaceAll('"../../clients/spike/e2ee"', '"./e2ee"')
        .replaceAll('"../../crates/protocol/generated/signaling"', '"./protocolSignaling"')]));
    if (process.env.DASS_RELEASE_VERSION) {
        parseVersion(process.env.DASS_RELEASE_VERSION);
        sources.set("releaseInfo.ts", sources.get("releaseInfo.ts").replace('"0.1.0-dev"', JSON.stringify(process.env.DASS_RELEASE_VERSION)));
    }
    const clientSources = [
        ["diagnostics.ts", "clients/spike/diagnostics.ts", [
            ['/** Callers', 'import { Logger } from "@utils/Logger";\n\nconst logger = new Logger("DASS");\n\n/** Callers'],
            ['console.error', 'logger.error'], ['console.info', 'logger.info']
        ]],
        ["spikePeer.ts", "clients/spike/peer.ts", [['"../../plugins/dass/routing"', '"./routing"'], ['"./signaling"', '"./spikeSignaling"'], ['"./e2ee"', '"./e2ee"']]],
        ["spikeSignaling.ts", "clients/spike/signaling.ts", [['"../../crates/protocol/generated/signaling"', '"./protocolSignaling"'], ['"../../crates/protocol/generated/validate"', '"./protocolValidate"']]],
        ["e2ee.ts", "clients/spike/e2ee.ts", []],
        ["protocolSignaling.ts", "crates/protocol/generated/signaling.ts", []],
        ["protocolValidate.ts", "crates/protocol/generated/validate.ts", [['"./signaling"', '"./protocolSignaling"']]]
    ];
    for (const [name, path, replacements] of clientSources) {
        let contents = readFileSync(join(rootDirectory, path), "utf8");
        for (const [from, to] of replacements) {
            if (!contents.includes(from)) throw new Error(`Client staging import did not match in ${path}.`);
            contents = contents.replaceAll(from, to);
        }
        if (name.startsWith("protocol")) {
            const eol = contents.includes("\r\n") ? "\r\n" : "\n";
            contents = ["/*", " * Vencord, a Discord client mod", " * Copyright (c) 2026 Vendicated and contributors", " * SPDX-License-Identifier: GPL-3.0-or-later", " */", "", ""].join(eol) + contents;
            contents = contents.replace("MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientMessage, type ServerMessage", "type ClientMessage, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ServerMessage");
        }
        sources.set(name, contents);
    }
    const sourceFiles = [...sources.keys()];
    const currentHashes = {};
    const obsoleteFiles = [];
    if (existsSync(stagedDirectory)) {
        for (const name of readdirSync(stagedDirectory)) {
            const stagedContents = readFileSync(join(stagedDirectory, name));
            if (digest(stagedContents) !== previousHashes[name] && stagedContents.toString("utf8") !== sources.get(name)) {
                throw new Error(`Staged plugin ${name} has unfamiliar changes; edit plugins/dass instead. Nothing was overwritten.`);
            }
            if (!sourceFiles.includes(name)) obsoleteFiles.push(name);
        }
    }

    writeFileSync(manifestPath, adaptedManifest);
    writeFileSync(lockPath, lockContents);
    mkdirSync(stagedDirectory, { recursive: true });
    // Delete only adapter-owned copies whose hashes matched the prior staging record.
    for (const name of obsoleteFiles) unlinkSync(join(stagedDirectory, name));
    for (const name of sourceFiles) {
        const contents = sources.get(name);
        writeFileSync(join(stagedDirectory, name), contents);
        currentHashes[name] = digest(contents);
    }
    writeFileSync(markerPath, JSON.stringify(currentHashes, null, 2) + "\n");

    run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"]);
    run("bun", ["run", "lint", "src/userplugins/dass"]);
    run("bun", ["run", "testTsc", "--project", join(rootDirectory, "tooling/equicord/tsconfig.json")]);
    run("bun", ["run", "build", "--disable-updater"]);

    const distDirectory = join(checkoutDirectory, "dist");
    for (const [target, entryPoint] of [["desktop", "patcher.js"], ["equibop", "main.js"]]) {
        if (!existsSync(join(distDirectory, target, entryPoint))) throw new Error(`${target} entry point was not built.`);
        const nativeBundle = readFileSync(join(distDirectory, target, entryPoint), "utf8");
        if (!nativeBundle.includes("encryptRememberedAccount") || !nativeBundle.includes("decryptRememberedAccount")) {
            throw new Error(`Built ${target} entry point does not contain DASS secure-login native helpers.`);
        }
        const renderer = readFileSync(join(distDirectory, target, "renderer.js"), "utf8");
        if (!renderer.includes("Discord Alternative ScreenShare: experimental authenticated directory and viewer.")) {
            throw new Error(`Built ${target} renderer does not contain the DASS plugin.`);
        }
    }
    console.log(`\nDASS desktop and Equibop bundles built in:\n${distDirectory}\nFor standard Discord desktop installation, see docs/plugin.md.\nFor Equibop, select this directory in Developer Options.\nFully quit and restart your client after installation, then enable DASS in Equicord Plugins.`);
} catch (error) {
    console.error(error instanceof Error ? error.message : "Plugin build failed.");
    process.exitCode = 1;
}
