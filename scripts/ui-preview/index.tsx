/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { ContextMenuApi, useState } from "@webpack/common";

import { StreamEndedScreen } from "../../plugins/dass/streamEnded";
import { StreamErrorScreen } from "../../plugins/dass/streamError";
import { StreamActionsMenu, StreamSidebarCard } from "../../plugins/dass/streamUi";
import { StreamVolumeControl } from "../../plugins/dass/volumeControl";

declare const __DASS_UI_CSS__: string;
declare const Vencord: {
    Webpack: { findByProps(...props: string[]): { createRoot(element: Element): { render(node: unknown): void; unmount(): void; }; }; };
};

declare global {
    interface Window {
        dassUiPreview?: { remove(): void; };
    }
}

window.dassUiPreview?.remove();
const mount = document.createElement("div");
mount.className = "vc-dass-ui-preview";
mount.setAttribute("role", "region");
mount.setAttribute("aria-label", "DASS visual preview");
const style = document.createElement("style");
style.textContent = __DASS_UI_CSS__;
document.body.append(style, mount);
const root = Vencord.Webpack.findByProps("createRoot").createRoot(mount);
let removed = false;
function remove() {
    if (removed) return;
    removed = true;
    ContextMenuApi.closeContextMenu();
    root.unmount();
    mount.remove();
    style.remove();
    delete window.dassUiPreview;
}
window.dassUiPreview = { remove };

function Preview() {
    const [local, setLocal] = useState(true);
    const [showPreview, setShowPreview] = useState(true);
    const [pauseWhenUnfocused, setPauseWhenUnfocused] = useState(true);
    const [premiumQuality, setPremiumQuality] = useState(true);
    const [ended, setEnded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [audio, setAudio] = useState({ muted: false, sliderPercent: 100 });
    const [status, setStatus] = useState("Visual mock only. Your active share is untouched.");
    const mockAction = (action: string) => () => setStatus(`${action} clicked. Preview only, no media action.`);
    return <>
        <header className="vc-dass-ui-preview-header">
            <strong>DASS UI preview</strong>
            <Button variant="none" size="xs" aria-label="Close DASS preview" onClick={remove}>Close</Button>
        </header>
        <div className="vc-dass-ui-preview-body">
            <div className="vc-dass-ui-preview-toolbar">
                <Button variant="secondary" size="xs" onClick={() => setLocal(!local)}>{local ? "Show viewer" : "Show publisher"}</Button>
                <Button variant="secondary" size="xs" onClick={() => setPremiumQuality(!premiumQuality)}>{premiumQuality ? "Standard quality" : "Nitro styling"}</Button>
                <Button variant="secondary" size="xs" onClick={() => setEnded(!ended)}>{ended ? "Show live tile" : "Stream ended"}</Button>
                <Button variant="secondary" size="xs" onClick={() => { setEnded(false); setFailed(!failed); }}>{failed ? "Show live tile" : "Stream error"}</Button>
            </div>
            {failed && !ended ? <div className="vc-dass-ui-preview-ended"><StreamErrorScreen started={false}
                message="DASS setup failed. Check TLS, room access, LAN IP matching and the UDP path. No Discord fallback."
                onClose={() => { setFailed(false); setStatus("Closed mock error only. Real viewing is untouched."); }} /></div>
                : ended ? <div className="vc-dass-ui-preview-ended"><StreamEndedScreen onClose={() => {
                setEnded(false);
                setStatus("Close Stream clicked. Preview only, no media action.");
            }} /></div> : <Button variant="secondary" size="xs" onClick={event => ContextMenuApi.openContextMenu(event, () => <StreamActionsMenu local={local}
                stop={mockAction(local ? "Stop Streaming" : "Stop Watching")} changeSource={mockAction("Change Stream")}
                previewOptions={{ showPreview, pauseWhenUnfocused, setShowPreview, setPauseWhenUnfocused: value => {
                    setPauseWhenUnfocused(value);
                    setStatus(`Pause when unfocused: ${value ? "on" : "off"}. Preview preference only, no media action.`);
                } }} />)}>Open stream menu</Button>}
            <StreamSidebarCard qualityLabel={premiumQuality ? "1080p 30FPS" : "720p 30FPS"} premiumQuality={premiumQuality} stop={mockAction("Stop Streaming")} />
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px" }}>
                <StreamVolumeControl {...audio} onToggleMute={() => setAudio({ ...audio, muted: !audio.muted })}
                    onVolumeChange={value => setAudio({ muted: value > 0 ? false : audio.muted, sliderPercent: value })} />
            </div>
            <p className="vc-dass-ui-preview-status" role="status">{status}</p>
        </div>
    </>;
}

root.render(<Preview />);
