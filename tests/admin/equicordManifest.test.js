import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { adaptEquicordManifest } from "../../scripts/equicordManifest.mjs";

const pinnedManifest = await readFile(new URL("../../vendor/Equicord/package.json", import.meta.url), "utf8");

describe("Equicord adapter manifest", () => {
    it("keeps only target-build dependencies and patched advisory versions", () => {
        const manifest = JSON.parse(adaptEquicordManifest(pinnedManifest));

        expect(manifest.devDependencies["@vencord/discord-types"]).toBe("file:packages/discord-types");
        expect(manifest.devDependencies["zip-local"]).toBeUndefined();
        expect(manifest.overrides).toEqual({ dompurify: "3.4.17", moment: "2.31.0" });

        const webBuild = readFileSync(new URL("../../vendor/Equicord/scripts/build/buildWeb.mjs", import.meta.url), "utf8");
        const buildAdapter = readFileSync(new URL("../../scripts/build-plugin.mjs", import.meta.url), "utf8");
        const zipImports = execFileSync("git", ["-C", "vendor/Equicord", "grep", "-l", '-e', 'from "zip-local"'], { encoding: "utf8" }).trim();
        expect(webBuild).toContain('import Zip from "zip-local"');
        expect(zipImports).toBe("scripts/build/buildWeb.mjs");
        expect(buildAdapter).toContain('["run", "build", "--disable-updater"]');
    });

    it("rejects an unexpected upstream dependency change", () => {
        expect(() => adaptEquicordManifest(pinnedManifest.replace('"zip-local": "^0.3.5"', '"zip-local": "^1.0.0"')))
            .toThrow("Pinned web-only zip-local dependency did not match.");
    });

    it("excludes only the unsupported web packager from the adapter typecheck", () => {
        const config = JSON.parse(readFileSync(new URL("../../tooling/equicord/tsconfig.json", import.meta.url), "utf8"));
        expect(config).toEqual({
            extends: "../../build/Equicord/tsconfig.json",
            compilerOptions: {
                rootDir: "../../build/Equicord",
                typeRoots: ["../../build/Equicord/node_modules/@types"]
            },
            exclude: ["../../build/Equicord/scripts/build/buildWeb.mjs"]
        });
        const buildAdapter = readFileSync(new URL("../../scripts/build-plugin.mjs", import.meta.url), "utf8");
        expect(buildAdapter).toContain('["run", "testTsc", "--project", join(rootDirectory, "tooling/equicord/tsconfig.json")]');
    });
});
