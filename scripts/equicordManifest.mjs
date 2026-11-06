export function adaptEquicordManifest(contents, workspaceContents) {
    const manifest = JSON.parse(contents);
    const catalog = Object.fromEntries([...workspaceContents.matchAll(/^ {4}"([^"]+)": "([^"]+)"$/gm)].map(([, name, version]) => [name, version]));
    manifest.workspaces = { packages: ["packages/discord-types"], catalog };
    for (const section of [manifest.dependencies, manifest.devDependencies]) {
        for (const [name, version] of Object.entries(section)) {
            if (version !== "catalog:") continue;
            if (!catalog[name]) throw new Error(`Missing pinned catalog version for ${name}.`);
            section[name] = catalog[name];
        }
    }
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
