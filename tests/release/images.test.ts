import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = Bun.YAML.parse(readFileSync(new URL("../../.github/workflows/images.yml", import.meta.url), "utf8")) as any;

test("image builds are manual, selectable and do not publish by default", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.image.options).toEqual(["both", "runtime", "pterodactyl"]);
    expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.build.strategy["fail-fast"]).toBe(false);
    expect(workflow.jobs.build.strategy.matrix.target).toContain('["runtime","pterodactyl"]');
});

test("manual images use the checked Dockerfile and isolate tags from releases", () => {
    const steps = workflow.jobs.build.steps;
    for (const step of steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    const metadata = steps.find((step: any) => step.id === "metadata").run;
    expect(metadata).toContain('tag="manual-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(metadata).toContain('tag="$tag-pterodactyl"');
    const build = steps.find((step: any) => step.id === "image").with;
    expect(build.context).toBe(".");
    expect(build.target).toBe("${{ matrix.target }}");
    expect(build.platforms).toBe("linux/amd64");
    expect(build.outputs).toContain("inputs.publish && 'type=registry'");
    expect(build.outputs).toContain("type=docker,dest=");
    expect(build.sbom).toBe("${{ inputs.publish }}");
    expect(steps.find((step: any) => step.uses?.startsWith("docker/login-action@")).if).toBe("inputs.publish");
    const artifact = steps.find((step: any) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(artifact.if).toBe("${{ !inputs.publish }}");
    expect(artifact.with["if-no-files-found"]).toBe("error");
    expect(steps.some((step: any) => step.run?.includes("gh release create"))).toBe(false);
});
