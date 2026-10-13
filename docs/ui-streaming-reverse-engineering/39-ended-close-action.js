/* Static source only; never invokes the close/watch action. */
(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["401843"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Stream action factory unavailable." });
    const source = factory.toString();
    const binding = source.match(/\bXi\s*:\s*\(\)\s*=>\s*([\w$]+)/);
    const name = binding?.[1];
    const declaration = name ? new RegExp("(?:async\\s+)?function\\s+" + name.replace(/\$/g, "\\$") + "\\s*\\(") : null;
    const offset = declaration ? source.search(declaration) : -1;
    return JSON.stringify({
        probe: "39-ended-close-action", sourceView: "original",
        sourceLength: source.length, binding: binding?.[0] || null,
        header: source.slice(0, 1100), offset,
        action: offset >= 0 ? source.slice(offset, offset + 2600) : null
    });
})();
