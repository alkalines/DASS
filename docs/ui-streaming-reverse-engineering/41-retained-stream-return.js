/* Original-source excerpts only; no store methods or watch callbacks invoked. */
(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["616356"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Active stream store factory unavailable." });
    const source = factory.toString();
    const anchors = ["function x(", "STREAM_WATCH:", "getAllActiveStreams("];
    const assignments = Array.from(source.matchAll(/\bv\s*=/g));
    return JSON.stringify({
        probe: "41-retained-stream-return", sourceView: "original",
        excerpts: anchors.map(anchor => {
            const offset = source.indexOf(anchor);
            return { anchor, offset, source: offset >= 0 ? source.slice(offset, offset + 1050) : null };
        }),
        retainedKeyAssignmentCount: assignments.length,
        retainedKeyAssignments: assignments.slice(0, 6).map(match => ({
            offset: match.index,
            source: source.slice(Math.max(0, match.index - 90), match.index + 180)
        }))
    });
})();
