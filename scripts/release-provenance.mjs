// Local evidence only: hashes do not authenticate artifacts or approve a release.
// Deliberately never read .env, .secrets, runtime policy or process environment.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const git = (args, cwd = rootDirectory) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) throw new Error("Cannot collect Git provenance.");
    return result.stdout.trim();
};
const sha256 = path => createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex");
const expectedPins = {
    "vendor/Equicord": "cb95617b390c52addac1ab456388ead3fd2dbe11",
    "vendor/Equibop": "57406f627221bc6054deb9834c18fa9cd914d96a"
};
const inputs = ["Cargo.toml", "Cargo.lock", "Dockerfile", "compose.yaml", "tooling/equicord/bun.lock", "scripts/build-plugin.mjs"];
const nodeVersion = spawnSync("node", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (nodeVersion.status !== 0) throw new Error("Cannot collect Node build-tool version.");
const submodules = Object.fromEntries(Object.entries(expectedPins).map(([path, expectedRevision]) => {
    const directory = fileURLToPath(new URL(`../${path}/`, import.meta.url));
    const revision = git(["rev-parse", "HEAD"], directory);
    const clean = git(["status", "--porcelain", "--untracked-files=normal"], directory) === "";
    return [path, { expectedRevision, revision, clean, matchesPin: revision === expectedRevision }];
}));
const record = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: git(["rev-parse", "HEAD"]),
    clean: git(["status", "--porcelain", "--untracked-files=normal"]) === "",
    bunVersion: Bun.version,
    nodeVersion: nodeVersion.stdout.trim(),
    inputSha256: Object.fromEntries(inputs.map(path => [path, sha256(path)])),
    submodules,
    deploymentAuthorized: false
};
console.log(JSON.stringify(record, null, 2));
if (!record.clean || Object.values(submodules).some(module => !module.clean || !module.matchesPin)) {
    // Print useful development evidence, but never bless a dirty/unpinned build.
    process.exitCode = 1;
}
