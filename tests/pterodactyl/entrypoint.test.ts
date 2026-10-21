import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve(import.meta.dir, "../../docker/pterodactyl/entrypoint.sh");

function withEntrypoint(
    environment: Record<string, string>,
    check: (result: ReturnType<typeof spawnSync>, directory: string) => void,
) {
    const directory = mkdtempSync(join(tmpdir(), "dass-entrypoint-"));
    try {
        // Redirect only the Wings mount for local shell checks. The actual image
        // and arbitrary runtime UID still need Docker/Wings acceptance tests.
        const result = spawnSync("/bin/bash", ["-c", `
            cd() {
                if [[ "$1" == /home/container ]]; then
                    builtin cd "$TEST_CONTAINER_HOME"
                else
                    builtin cd "$@"
                fi
            }
            source "$1"
        `, "entrypoint-test", entrypoint], {
            encoding: "utf8",
            env: {
                PATH: process.env.PATH,
                TEST_CONTAINER_HOME: directory,
                DASS_DATABASE_FILE: join(directory, "data/dass.sqlite3"),
                ...environment,
            },
        });
        check(result, directory);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test("prepares private data directory, mount working directory and allocation", () => {
    withEntrypoint({
        SERVER_PORT: "8443",
        STARTUP: `/bin/bash -c 'printf "%s\\n" "$PWD" "$HOME" "$TZ" "$DASS_LISTEN_ADDR" "$DASS_ADMIN_DATA_FILE"'`,
    }, (result, directory) => {
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`Starting DASS.\n${directory}\n/home/container\nUTC\n0.0.0.0:8443\n/home/container/data/policy.json\n`);
        expect(statSync(join(directory, "data")).mode & 0o777).toBe(0o700);
    });
});

test("expands repeated quoted placeholders without executing their contents or logging them", () => {
    const value = 'private value $(touch SHOULD_NOT_EXIST); `id` $HOME "quoted"';
    withEntrypoint({
        OPTION: value,
        STARTUP: `/usr/bin/printf '%s\\n' "{{OPTION}}" "{{OPTION}}"`,
    }, (result, directory) => {
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`Starting DASS.\n${value}\n${value}\n`);
        expect(existsSync(join(directory, "SHOULD_NOT_EXIST"))).toBe(false);
        expect(result.stderr).toBe("");
    });
});

test("preserves explicit listen address and timezone", () => {
    withEntrypoint({
        DASS_LISTEN_ADDR: "127.0.0.1:9443",
        TZ: "Europe/Paris",
        STARTUP: `/bin/bash -c 'printf "%s\\n" "$DASS_LISTEN_ADDR" "$TZ"'`,
    }, result => {
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("Starting DASS.\n127.0.0.1:9443\nEurope/Paris\n");
    });
});

test("rejects missing or malformed egg variables", () => {
    for (const placeholder of ["{{MISSING}}", "{{INVALID-NAME}}", "{{UNCLOSED"]) {
        withEntrypoint({ STARTUP: `/usr/bin/printf '%s' '${placeholder}'` }, result => {
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
        });
    }
});

test("allows empty values and preserves process exit status", () => {
    withEntrypoint({ OPTION: "", STARTUP: `/usr/bin/printf '<%s>' "{{OPTION}}"` }, result => {
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("Starting DASS.\n<>");
    });
    withEntrypoint({ STARTUP: "/bin/bash -c 'exit 42'" }, result => {
        expect(result.status).toBe(42);
    });
});

test("replaces the entrypoint process rather than leaving a signal-blocking wrapper", () => {
    withEntrypoint({ STARTUP: `/bin/bash -c 'printf "%s" "$$"'` }, result => {
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`Starting DASS.\n${result.pid}`);
    });
});
