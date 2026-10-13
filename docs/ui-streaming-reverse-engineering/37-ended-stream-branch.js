/* Read-only original-source excerpt; never invokes factories or watch actions. */
(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["802867"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Stream tile factory unavailable." });
    const source = factory.toString();
    const offset = source.indexOf("function ei(");
    return JSON.stringify({
        probe: "37-ended-stream-branch", sourceView: "original",
        sourceLength: source.length, offset,
        header: source.slice(0, 1200),
        playerBranch: offset >= 0 ? source.slice(offset, offset + 3600) : null
    });
})();
