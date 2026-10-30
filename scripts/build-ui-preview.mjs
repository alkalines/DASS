/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("build/Equicord/package.json", root));
const { build } = require("esbuild");
const chooserPreview = process.argv.includes("--chooser");
const css = ["plugins/dass/streamUi.css", "plugins/dass/streamEnded.css", "plugins/dass/streamError.css", "plugins/dass/volumeControl.css", "scripts/ui-preview/preview.css"]
    .map(path => readFileSync(new URL(path, root), "utf8")).join("\n");
const result = await build({
    entryPoints: [fileURLToPath(new URL(chooserPreview ? "scripts/ui-preview/chooser.ts" : "scripts/ui-preview/index.tsx", root))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: chooserPreview ? "DassChooserPreview" : undefined,
    platform: "browser",
    jsx: "transform",
    jsxFactory: "Vencord.Webpack.Common.React.createElement",
    jsxFragment: "Vencord.Webpack.Common.React.Fragment",
    define: { __DASS_UI_CSS__: JSON.stringify(css) },
    plugins: [{
        name: "existing-equicord-runtime",
        setup(builder) {
            builder.onResolve({ filter: /^(@webpack|@webpack\/common|@components\/Button|@components\/Heading|@components\/Paragraph|@components\/ErrorBoundary|@utils\/misc|@utils\/discord)$/ }, args => ({ path: args.path, namespace: "host" }));
            builder.onLoad({ filter: /.*/, namespace: "host" }, args => ({
                contents: args.path === "@webpack"
                    ? "export const {findCssClassesLazy}=Vencord.Webpack;"
                    : args.path === "@webpack/common"
                    ? "export const {Clickable,closeModal,ContextMenuApi,Menu,Modal,openModal,React,Tooltip,useEffect,useLayoutEffect,useRef,useState}=Vencord.Webpack.Common;"
                    : args.path === "@components/Button"
                        ? "export const {Button}=Vencord.Components;"
                        : args.path === "@components/Heading"
                            ? "export const {Heading}=Vencord.Components;"
                        : args.path === "@components/Paragraph"
                            ? "export const {Paragraph}=Vencord.Components;"
                        : args.path === "@components/ErrorBoundary"
                            ? "export default Vencord.Components.ErrorBoundary;"
                        : args.path === "@utils/discord"
                            ? "export const {getIntlMessage}=Vencord.Util;"
                            : "export const classes=(...names)=>names.filter(Boolean).join(' ');",
                loader: "js"
            }));
            builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "preview-css" }));
            builder.onLoad({ filter: /.*/, namespace: "preview-css" }, () => ({ contents: "", loader: "js" }));
        }
    }]
});
mkdirSync("/tmp/opencode", { recursive: true });
const outputPath = chooserPreview ? "/tmp/opencode/dass-chooser-preview.js" : "/tmp/opencode/dass-ui-preview.js";
writeFileSync(outputPath, result.outputFiles[0].text);
console.log(`Built ${outputPath} using host UI primitives. No capture or network callbacks included.`);
