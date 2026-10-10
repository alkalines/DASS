import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EQUICORD_REVISION = "e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4";
const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
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
    const bunVersion = run("bun", ["--version"], rootDirectory, true);
    if (bunVersion !== "1.4.2") throw new Error(`This build is validated with Bun 1.4.2, not ${bunVersion}.`);
    if (Number(run("node", ["--version"], rootDirectory, true).slice(1).split(".")[0]) < 22) {
        throw new Error("Equicord requires Node >=22 for its build script.");
    }

    if (!existsSync(checkoutDirectory)) {
        mkdirSync(join(rootDirectory, "build"), { recursive: true });
        run("git", ["clone", "--no-checkout", "https://github.com/Equicord/Equicord.git", checkoutDirectory], rootDirectory);
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
    const adaptedManifest = originalManifest.replace('"link:packages/discord-types"', '"file:packages/discord-types"');
    if (adaptedManifest === originalManifest) throw new Error("Pinned local-types dependency did not match.");
    const manifestPath = join(checkoutDirectory, "package.json");
    const currentManifest = readFileSync(manifestPath, "utf8");
    if (currentManifest !== originalManifest && currentManifest !== adaptedManifest) {
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
    const sourceFiles = readdirSync(sourceDirectory);
    const currentHashes = {};
    if (existsSync(stagedDirectory)) {
        for (const name of readdirSync(stagedDirectory)) {
            const stagedContents = readFileSync(join(stagedDirectory, name));
            const sourcePath = join(sourceDirectory, name);
            if (!sourceFiles.includes(name) || (!stagedContents.equals(readFileSync(sourcePath)) && digest(stagedContents) !== previousHashes[name])) {
                throw new Error(`Staged plugin ${name} has unfamiliar changes; edit plugins/dass instead. Nothing was overwritten.`);
            }
        }
    }

    writeFileSync(manifestPath, adaptedManifest);
    writeFileSync(lockPath, lockContents);
    mkdirSync(stagedDirectory, { recursive: true });
    for (const name of sourceFiles) {
        const contents = readFileSync(join(sourceDirectory, name));
        writeFileSync(join(stagedDirectory, name), contents);
        currentHashes[name] = digest(contents);
    }
    writeFileSync(markerPath, JSON.stringify(currentHashes, null, 2) + "\n");

    run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"]);
    run("bun", ["run", "lint", "src/userplugins/dass"]);
    run("bun", ["run", "testTsc"]);
    run("bun", ["run", "build", "--disable-updater"]);

    const distDirectory = join(checkoutDirectory, "dist");
    if (!existsSync(join(distDirectory, "equibop/main.js"))) throw new Error("Equibop entry point was not built.");
    const renderer = readFileSync(join(distDirectory, "equibop/renderer.js"), "utf8");
    if (!renderer.includes("Discord Alternative ScreenShare: backend discovery scaffold.")) {
        throw new Error("Built Equibop renderer does not contain the DASS plugin.");
    }
    console.log(`\nDASS bundle built. In Equibop Developer Options, select:\n${distDirectory}\nFully quit and restart Equibop, then enable DASS in Equicord Plugins.`);
} catch (error) {
    console.error(error instanceof Error ? error.message : "Plugin build failed.");
    process.exitCode = 1;
}
