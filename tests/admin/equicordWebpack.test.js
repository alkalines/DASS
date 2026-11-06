import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Equicord webpack compatibility", () => {
    const original = readFileSync(new URL("../../vendor/Equicord/src/webpack/patchWebpack.ts", import.meta.url), "utf8");
    const helper = new Bun.Transpiler({ loader: "ts" }).transformSync("function install() {" + original.slice(original.indexOf("this.d = function"), original.indexOf("\n            };", original.indexOf("this.d = function")) + 15) + "}");
    const host = {};
    new Function(helper + "install.call(this);").call(host);

    test("supports old getters and new value exports without invoking values", () => {
        const exports = {};
        let current = 1;
        class Logger {}
        host.d(exports, { live: () => current }, { A: Logger, zero: 0, missing: undefined });
        expect(exports.live).toBe(1);
        current = 2;
        expect(exports.live).toBe(2);
        expect(new exports.A()).toBeInstanceOf(Logger);
        expect(exports.zero).toBe(0);
        expect(Object.hasOwn(exports, "missing")).toBe(true);
        expect(Object.getOwnPropertyDescriptor(exports, "A").configurable).toBe(true);
        host.d(exports, { live: () => 3 });
        expect(exports.live).toBe(2);
    });

    test("ignores inherited exports and preserves existing ones", () => {
        const exports = { existing: 1 };
        host.d(exports, {}, Object.assign(Object.create({ inherited: 2 }), { existing: 3, own: 4 }));
        expect(exports).toEqual({ existing: 1, own: 4 });
    });

});
