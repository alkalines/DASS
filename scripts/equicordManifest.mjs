export function adaptEquicordManifest(contents) {
    const manifest = JSON.parse(contents);
    if (!["link:packages/discord-types", "file:packages/discord-types"].includes(manifest.devDependencies?.["@vencord/discord-types"])) {
        throw new Error("Pinned local-types dependency did not match.");
    }
    if (manifest.devDependencies["zip-local"] !== "^0.3.5") {
        throw new Error("Pinned web-only zip-local dependency did not match.");
    }

    manifest.devDependencies["@vencord/discord-types"] = "file:packages/discord-types";
    delete manifest.devDependencies["zip-local"];
    manifest.overrides = { ...manifest.overrides, dompurify: "3.4.17", moment: "2.31.0" };
    return JSON.stringify(manifest, null, 4) + "\n";
}
