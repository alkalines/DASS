/* Static helper/action source; no watching or native event dispatch. */
(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    const targets = [
        { moduleId: "130553", anchor: "function x(", limit: 1100 },
        { moduleId: "401843", anchor: "function v(", limit: 1000 }
    ];
    return JSON.stringify({
        probe: "43-return-watch-guards", sourceView: "original",
        excerpts: targets.map(({ moduleId, anchor, limit }) => {
            const source = factories[moduleId]?.toString() || "";
            const offset = source.indexOf(anchor);
            return { moduleId, anchor, offset, source: offset >= 0 ? source.slice(offset, offset + limit) : null };
        })
    });
})();
