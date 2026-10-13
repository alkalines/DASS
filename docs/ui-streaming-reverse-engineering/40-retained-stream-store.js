/* Bounded original-source inventory; no store reads or event dispatches. */
(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["616356"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Active stream store factory unavailable." });
    const source = factory.toString();
    const anchors = ["STREAM_CREATE:", "STREAM_DELETE:", "STREAM_CLOSE:", "getActiveStreamForUser("];
    return JSON.stringify({
        probe: "40-retained-stream-store", sourceView: "original",
        sourceLength: source.length, header: source.slice(0, 600),
        excerpts: anchors.map(anchor => {
            const offset = source.indexOf(anchor);
            return { anchor, offset, source: offset >= 0 ? source.slice(Math.max(0, offset - 60), offset + 750) : null };
        })
    });
})();
