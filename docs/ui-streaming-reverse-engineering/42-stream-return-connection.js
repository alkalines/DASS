/* Bounded static source only; no sessions, stores or callbacks invoked. */
(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    const managerSource = factories["130553"]?.toString() || "";
    const storeSource = factories["616356"]?.toString() || "";
    const anchors = ["handleStreamCreate=", "handleStreamDelete=", "handleStreamClose="];
    return JSON.stringify({
        probe: "42-stream-return-connection", sourceView: "original",
        managerLength: managerSource.length, header: managerSource.slice(0, 650),
        handlers: anchors.map(anchor => {
            const offset = managerSource.indexOf(anchor);
            return { anchor, offset, source: offset >= 0 ? managerSource.slice(offset, offset + 1000) : null };
        }),
        storeTail: storeSource.slice(7600, 8050)
    });
})();
