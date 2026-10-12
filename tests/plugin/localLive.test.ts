/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { DISCORD_SHARE_PATCHES, isLocalPublisherLive } from "../../plugins/dass/discordAdapter";

const OBSERVED_ICON_PREFIX = 'function el(e){let{className:s,mute:t,localMute:n,localVideoDisabled:l,serverMute:r,deaf:c,serverDeaf:u,collapsed:C,video:I,isStreaming:S,disabled:_,isWatching:k,ringing:b,iconClassName:D,embeddedApplication:y,otherClientSessionType:M,voicePlatform:V,application:U,game:F,guildId:K,channelId:w,user:z,disconnected:H,isHovered:Z}=e,B=C||_,{enabled:J}=G.useConfig({guildId:K??"",location:"VoiceUserIcons"}),{previewUrl:X}=(0,P.A)(K,w,J&&S&&!B?z.id:void 0),$=null!=X&&""!==X.trim();if(B)return null;';
const OBSERVED_BADGE_EXPRESSION = 'return(J&&null!=el&&Q.push(el),S&&!$&&Q.push((0,i.jsx)(v.Ay,{size:v.Ay.Sizes.SMALL},"stream"))';
const fixtureSource = OBSERVED_ICON_PREFIX + 'let Q=[],el=null;' + OBSERVED_BADGE_EXPRESSION + '),Q}';

function patchedIcons(source = fixtureSource) {
    const patch = DISCORD_SHARE_PATCHES[2];
    expect(patch.find).toBe("VoiceUserIcons");
    expect(patch.fromBuild).toBe(634304);
    expect(patch.toBuild).toBe(634304);
    expect(patch.group).toBe(true);
    for (const replacement of patch.replacement) {
        const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
        expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
        source = source.replace(regex, replacement.replace);
    }
    return source;
}

test("local LIVE presentation needs owned capture in the same call, never a guessed remote identity", () => {
    const context = { pluginActive: true, publisherPhase: "publishing", discordUserId: "self", localDiscordUserId: "self",
        discordChannelId: "call", currentDiscordChannelId: "call" };
    for (const publisherPhase of ["preparing", "prepared", "activating", "publishing"]) {
        expect(isLocalPublisherLive({ ...context, publisherPhase })).toBe(true);
    }
    for (const publisherPhase of ["idle", "authenticating", "capturing", "failed", "unknown"]) {
        expect(isLocalPublisherLive({ ...context, publisherPhase })).toBe(false);
    }
    expect(isLocalPublisherLive({ ...context, pluginActive: false })).toBe(false);
    expect(isLocalPublisherLive({ ...context, discordUserId: "remote" })).toBe(false);
    expect(isLocalPublisherLive({ ...context, localDiscordUserId: undefined })).toBe(false);
    expect(isLocalPublisherLive({ ...context, discordChannelId: "other_call" })).toBe(false);
    expect(isLocalPublisherLive({ ...context, currentDiscordChannelId: undefined })).toBe(false);
});

test("LIVE hook precedes the native early return and does not alter the preview hook's input", () => {
    const source = patchedIcons();
    expect(source.indexOf("$self.useLocalLiveState")).toBeLessThan(source.indexOf("if(B)return null"));
    expect(source).toContain('(0,P.A)(K,w,J&&S&&!B?z.id:void 0)');
    expect(source).toContain('(dassOwnLive||S&&!$)&&Q.push');
    expect(() => new Function("G", "P", "i", "v", "$self", `return ${source}`)).not.toThrow();
    const renamed = patchedIcons(fixtureSource.replace(/\bw\b/g, "discordChannel").replace(/\bz\b/g, "voiceUser"));
    expect(renamed).toContain("$self.useLocalLiveState(voiceUser.id,discordChannel)");
});

function renderIcons(dassLive: boolean, nativeLive = false, collapsed = false, nativePreview?: string) {
    const previewOwners: Array<string | undefined> = [];
    let hookCalls = 0;
    const render = new Function("G", "P", "i", "v", "$self", `return ${patchedIcons()}`)(
        { useConfig: () => ({ enabled: true }) },
        { A: (_guild: string, _channel: string, userId?: string) => { previewOwners.push(userId); return { previewUrl: nativePreview }; } },
        { jsx: (_component: unknown, props: unknown, key: string) => ({ props, key }) },
        { Ay: { Sizes: { SMALL: "small" } } },
        { useLocalLiveState: (userId: string, channelId: string) => {
            expect(userId).toBe("self"); expect(channelId).toBe("call"); hookCalls++; return dassLive;
        } }
    );
    const result = render({ user: { id: "self" }, guildId: "guild", channelId: "call", isStreaming: nativeLive, collapsed });
    return { result, previewOwners, hookCalls };
}

test("DASS uses the native small LIVE badge without requesting a Discord preview", () => {
    const rendered = renderIcons(true);
    expect(rendered.result).toEqual([{ props: { size: "small" }, key: "stream" }]);
    expect(rendered.previewOwners).toEqual([undefined]);
    expect(rendered.hookCalls).toBe(1);
    expect(renderIcons(false).result).toEqual([]);
});

test("native LIVE and preview behavior is retained; collapsing does not change hook count", () => {
    expect(renderIcons(false, true).result).toHaveLength(1);
    expect(renderIcons(false, true).previewOwners).toEqual(["self"]);
    expect(renderIcons(false, true, false, "native_preview").result).toEqual([]);
    const collapsed = renderIcons(true, false, true);
    expect(collapsed.result).toBeNull();
    expect(collapsed.hookCalls).toBe(1);
    expect(collapsed.previewOwners).toEqual([undefined]);
});
