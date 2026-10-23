import { memoryIdentityStore } from "./helpers/e2eeStore";
import { expect, spyOn, test } from "bun:test";
import { browserFailureCode, mediaDiagnostics } from "../../clients/spike/diagnostics";
import { createEquibopCapture } from "../../plugins/dass/capture";
import { PublishController } from "../../plugins/dass/publishing";
import { DassSession } from "../../plugins/dass/session";
import { SpikeSignalingError } from "../../clients/spike/signaling";

test("media diagnostics join the active codec and expose only allowlisted counters", () => {
    const report = new Map([
        ["codec", { type: "codec", mimeType: "video/VP8", payloadType: 96, clockRate: 90000, sdpFmtpLine: "private-key" }],
        ["video", { type: "inbound-rtp", kind: "video", codecId: "codec", bytesReceived: 12000, packetsReceived: 20,
            framesDecoded: 0, packetsLost: -1, decoderImplementation: "private-source", trackIdentifier: "private-track", frameWidth: NaN }],
        ["pair", { type: "candidate-pair", address: "private-address" }],
        ["out", { type: "outbound-rtp", kind: "video", codecId: "codec", framesEncoded: 30 }]
    ]) as unknown as RTCStatsReport;
    expect(mediaDiagnostics(report, false)).toEqual([{
        role: "viewer", kind: "video", codec: "video/vp8", payloadType: 96, clockRate: 90000,
        bytesReceived: 12000, packetsReceived: 20, framesDecoded: 0, packetsLost: -1, decoderImplementation: "other"
    }]);
    expect(mediaDiagnostics(report, true)).toEqual([{
        role: "publisher", kind: "video", codec: "video/vp8", payloadType: 96, clockRate: 90000, framesEncoded: 30
    }]);
    expect(JSON.stringify(mediaDiagnostics(report, false))).not.toContain("private");
});

test("media diagnostics bound rows and tolerate missing or unexpected codec data", () => {
    const report = new Map(Array.from({ length: 10 }, (_, index) => [String(index), {
        type: "inbound-rtp", mediaType: "video", codecId: "missing", framesDecoded: Infinity
    }])) as unknown as RTCStatsReport;
    expect(mediaDiagnostics(report, false)).toEqual(Array.from({ length: 4 }, () => ({ role: "viewer", kind: "video", codec: "unknown" })));
});

test("capture diagnostics omit raw browser error messages and stacks", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const error = new DOMException("private-source secret-password https://private.example", "NotAllowedError");
    try {
        const capture = createEquibopCapture({ version: 1, capture: async () => { throw error; } });
        await expect(capture(new AbortController().signal)).rejects.toBe(error);
        expect(errorLog).toHaveBeenCalledWith("[DASS] capture failed or cancelled", { code: "NotAllowedError" });
        const logs = JSON.stringify([...info.mock.calls, ...errorLog.mock.calls]);
        expect(logs).not.toContain("private-source");
        expect(logs).not.toContain("secret-password");
        expect(logs).not.toContain("private.example");
        expect(browserFailureCode(new Error("private details"))).toBe("unknown");
        expect(browserFailureCode({ name: "NotAllowedError", message: "secret" })).toBe("unknown");
    } finally {
        info.mockRestore();
        errorLog.mockRestore();
    }
});

test("publisher authorization failures log stage and code without session identifiers", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const session = new DassSession();
    const publisher = new PublishController(session, () => "private_discord_context", {
        connect: async () => { throw new SpikeSignalingError("rejected:unauthorized"); },
        prepare: async () => { throw new Error("unexpected capture"); },
        identityStore: async () => memoryIdentityStore()
    });
    try {
        session.configure("private_room", "secret-credential");
        publisher.start();
        await publisher.publish("https://private.example");
        expect(publisher.getSnapshot().phase).toBe("failed");
        expect(errorLog.mock.calls.some(call => call[0] === "[DASS] publisher setup failed"
            && call[1].phase === "authenticating" && call[1].code === "rejected:unauthorized")).toBe(true);
        const logs = JSON.stringify([...info.mock.calls, ...errorLog.mock.calls]);
        for (const secret of ["private_room", "secret-credential", "private_discord_context", "private.example"]) {
            expect(logs).not.toContain(secret);
        }
    } finally {
        publisher.stop();
        info.mockRestore();
        errorLog.mockRestore();
    }
});
