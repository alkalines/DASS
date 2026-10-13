/* Read-only source lookup; no factory, callback or media invocation. */
(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    const source = factories["802867"]?.toString() || "";
    const bindings = Array.from(source.matchAll(/\bU\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const moduleId = bindings.length === 1 ? bindings[0][1] : null;
    const factory = moduleId && factories[moduleId];
    const componentSource = typeof factory === "function" ? factory.toString() : "";
    return JSON.stringify({
        probe: "38-ended-component", sourceView: "original",
        bindingCount: bindings.length, moduleId,
        sourceLength: componentSource.length,
        source: componentSource.slice(0, 3400),
        truncated: componentSource.length > 3400,
        unavailable: !componentSource
    });
})();
