import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { parseVersion } from "./release-plan.mjs";

export function changelogSection(changelog, version) {
    parseVersion(version);
    const sections = [...changelog.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\r?$/gm)];
    const matches = sections.filter(section => section[1] === version);
    if (matches.length !== 1) throw new Error(`Expected exactly one dated changelog entry for ${version}.`);
    const section = matches[0];
    const next = sections[sections.indexOf(section) + 1];
    const body = changelog.slice(section.index + section[0].length, next?.index).trim();
    if (!body) throw new Error(`Changelog entry for ${version} is empty.`);
    // GitHub removes brackets/dots but preserves spaces as hyphens and literal hyphens.
    const anchor = `${version.replaceAll(".", "")}---${section[2]}`;
    return { body, anchor };
}

export function changelogEntry(changelog, version) {
    return changelogSection(changelog, version).body;
}

export function releaseNotes({ version, component, repository, revision, equicordRevision, equibopRevision,
    image, digest, pterodactylDigest, changes, checksums, changelogAnchor }) {
    parseVersion(version);
    if (!new RegExp(`^${version.replaceAll(".", "")}---\\d{4}-\\d{2}-\\d{2}$`).test(changelogAnchor ?? "")) {
        throw new Error("Expected the matching dated changelog anchor.");
    }
    if (!["all", "backend"].includes(component)) throw new Error("Unknown release component.");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository.");
    for (const hash of [revision, equicordRevision, equibopRevision]) {
        if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error("Expected a full Git revision.");
    }
    for (const hash of [digest, pterodactylDigest]) {
        if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error("Expected an immutable image digest.");
    }
    if (!image || /[\s`]/.test(image)) throw new Error("Invalid image name.");
    if (!changes?.trim()) throw new Error("Release notes require changelog content.");
    if (component === "all" && !new RegExp(`^[a-f0-9]{64}  dass-equicord-${version.replaceAll(".", "\\.")}\\.zip$`).test(checksums?.trim() ?? "")) {
        throw new Error("Full releases require the matching ZIP SHA-256 checksum.");
    }
    const source = `https://github.com/${repository}`;
    return `# Discord Alternative ScreenShare (DASS) ${version}

> [!WARNING]
> **Experimental release.** Production use and unrestricted public deployment are not recommended. Use only for controlled testing at your own risk. Successful builds and functional tests are not an independent security audit or a guarantee of compatibility, confidentiality or availability.

## Changes

${component === "backend" ? "**Backend-only release: no client ZIP is included.** The entry below describes the source revision; client changes are not shipped in this release.\n\n" : ""}${changes}

## Source revisions

- DASS: [\`${revision}\`](${source}/commit/${revision})
- Equicord: [\`${equicordRevision}\`](https://github.com/Equicord/Equicord/commit/${equicordRevision})
- Equibop compatibility pin: [\`${equibopRevision}\`](https://github.com/Equicord/Equibop/commit/${equibopRevision}) (not a bundled host application)

## Backend images (linux/amd64)

| Target | Versioned image | Immutable image |
| --- | --- | --- |
| Standard | \`${image}:${version}\` | \`${image}@${digest}\` |
| Pterodactyl | \`${image}:${version}-pterodactyl\` | \`${image}@${pterodactylDigest}\` |

Updates are manual. Back up configuration and the SQLite volume before updating.

## Client bundle and verification

${component === "all" ? `The ZIP contains the complete custom Equicord build, not a loose plugin or a modified Equibop application. Verify it against the attached \`SHA256SUMS\`:

\`\`\`text
${checksums.trim()}
\`\`\`` : "No client bundle is included in this backend-only release."}

Hashes detect corruption and identify artifacts; they are not independent signatures or evidence of runtime/security acceptance. Both ends need compatible DASS clients; stock Discord cannot receive DASS media. Build success does not verify capture, consent, cleanup or absence of Discord media leakage on a particular client.

[Full changelog](${source}/blob/${revision}/docs/change-logs.md#${changelogAnchor}).
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const version = process.env.VERSION;
    const { body: changes, anchor: changelogAnchor } = changelogSection(readFileSync("docs/change-logs.md", "utf8"), version);
    if (process.argv.includes("--check")) {
        console.log(`Changelog entry found for ${version}.`);
    } else {
        const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
        writeFileSync("release-notes.md", releaseNotes({ version, changes, changelogAnchor,
            component: process.env.COMPONENT, repository: process.env.GITHUB_REPOSITORY,
            revision: process.env.GITHUB_SHA,
            equicordRevision: git(["rev-parse", "HEAD:vendor/Equicord"]),
            equibopRevision: git(["rev-parse", "HEAD:vendor/Equibop"]),
            image: process.env.IMAGE, digest: process.env.DIGEST,
            pterodactylDigest: process.env.PTERODACTYL_DIGEST,
            checksums: process.env.COMPONENT === "all" ? readFileSync("artifacts/SHA256SUMS", "utf8") : undefined
        }));
    }
}
