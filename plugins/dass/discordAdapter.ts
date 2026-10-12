/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease, DassShare, RoutingResult, ScreenshareRouting } from "./routing";

const VOICE_PANEL_SHARE_START_MATCH = /(\i=\i\.useCallback\(\(\)=>\{)(\(0,\i\.A\)\(\i,\i\.id,\i\))(?=\},\[\i,\i\.id,\i\]\),\i=\i\.find\(\i=>\i\.ownerId===\i\?\.id\))/;
const CALL_GRID_ROOT_MATCH = /(channel:(\i),hasConnectPermission:\i,className:\i,inCall:\i,showParticipants:\i=!0,width:\i,height:\i,idle:\i,mode:\i,popoutType:\i,awaitingRemoteSessionInfo:\i,callContainerDimensions:\i\}=\i;)(?=\i\.useEffect\(\(\)=>\{\i\._\.dispatch\(\i\.jej.REMEASURE_TARGET\))/;

export const NATIVE_TILE_FRAME_SOURCE_SIGNATURE = ['"data-selenium-video-tile":', '"data-call-tile":""'] as const;
export const NATIVE_LIVE_BADGE_SOURCE_SIGNATURE = ['"RED"===', ".BADGE_NOTIFICATION_BACKGROUND.css"] as const;

export const DISCORD_SHARE_PATCHES = [{
    find: /renderNUXHighlight:\i,buttonRef:\i,onClick:null!=\i\?\i:\i(?=\}\))/,
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(?<=\(0,\i\.jsx\)\()(\i\.\i),\{\.\.\.(\i)(?=,centerButton:!0,disabled:\i\|\|!\i,className:\i\.\i,hasPermission:\i,streamActive:)/,
        replace: "$self.ShareButton,{dassNativeComponent:$1,...$2"
    }, {
        match: /onClick:null!=(\i)\?(\i):(\i)(?=\}\))/,
        replace: "onClick:null!=$1?$2:()=>$self.chooseShareTransport($3)"
    }]
}, {
    find: VOICE_PANEL_SHARE_START_MATCH,
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(\i=\i\.useCallback\(\(\)=>\{)(\(0,\i\.A\)\(\i,(\i)\.id,\i\))(\},\[\i,\i\.id,\i\]\),\i=\i\.find\((\i)=>\5\.ownerId===\i\?\.id\))/,
        replace: "$1$self.chooseShareTransport(()=>$2)$4,dassSidebarPublishing=$self.usePublishingState($3.id)"
    }, {
        match: /(\i=)(null==\i\?\i\?\i:\i\.A:\(\)=>\(0,\i\.A\)\(\i\))(?=;let \i=null!=\i\|\|\i\.length>0,)/,
        replace: "$1dassSidebarPublishing?()=>$self.stopPublishing():$2"
    }, {
        match: /(\i=)(null!=\i\|\|\i\.length>0)(?=,\i=\i\?\i\.intl\.string\()/,
        replace: "$1!dassSidebarPublishing&&($2)"
    }, {
        match: /(\i=)(null!=\i)(?=,\{Component:\i,events:\i,play:\i\}=\(0,\i\.c\)\(\i\?"disable":"enable"\))/,
        replace: "$1dassSidebarPublishing||$2"
    }, {
        match: /(?<=\{text:)(\i)(?=,children:\(0,\i\.jsx\)\(\i\.\i,\{"data-migration-pending":!0,buttonRef:\i,size:\i\.\i\.Sizes.MEDIUM,"aria-pressed":null!=\i,)/,
        replace: 'dassSidebarPublishing?"Stop Streaming":$1'
    }, {
        match: /("data-migration-pending":!0,buttonRef:\i,size:\i\.\i\.Sizes.MEDIUM,"aria-pressed":)(null!=\i)/,
        replace: "$1dassSidebarPublishing||$2"
    }, {
        match: /(\i\.O.STREAM,)(null==\i)(?=\),\i\?\i\(\i\):\i\(\)\},disabled:)/,
        replace: "$1!dassSidebarPublishing&&$2"
    }, {
        match: /disabled:(!\i\|\|\i),className:(\i\(\)\(\i\.\i,\i\.\i,\{\[\i\.\i\]:)(null!=\i)(,\[\i\.\i\]:)(!\i\|\|\i)(\}\))(?=,\.\.\.\i\?\i:null,onMouseEnter:)/,
        replace: "disabled:!dassSidebarPublishing&&($1),className:$2dassSidebarPublishing||$3$4!dassSidebarPublishing&&($5)$6"
    }, {
        match: /(children:\i\?\i:\(0,\i\.jsxs\)\(\i\.A,\{align:\i\.A\.Align.CENTER,children:\[\i,)(\i\.intl\.string\(\i\.t\["[^"]{1,32}"\]\))(?=\]\}\)\}\)\}\)\}\}\))/,
        replace: '$1dassSidebarPublishing?"Stop Streaming":$2'
    }]
}, {
    find: "VoiceUserIcons",
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(guildId:\i,channelId:(\i),user:(\i),disconnected:\i,isHovered:\i\}=\i)(?=,\i=\i\|\|\i,\{enabled:\i\}=\i\.useConfig\(\{guildId:\i\?\?"",location:"VoiceUserIcons"\}\))/,
        replace: "$1,dassOwnLive=$self.useLocalLiveState($3.id,$2)"
    }, {
        match: /(?<=return\(\i&&null!=\i&&\i\.push\(\i\),)(\i&&!\i)(?=&&\i\.push\(\(0,\i\.jsx\)\(\i\.Ay,\{size:\i\.Ay\.Sizes.SMALL\},"stream"\)\))/,
        replace: "(dassOwnLive||$1)"
    }]
}, {
    find: "ImpressionNames.CHANNEL_CALL_VIDEO_GRID_VIEW",
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(\i=)(\i\.map\((\i)=>(\i)=>\(0,\i\.jsx\)\(\i\.Ay,\{participant:\3,channel:(\i),className:(\i\.\i),onClick:(\i),onDoubleClick:(\i),onContextMenu:\i,inCall:\i,width:\4,popoutType:\i\},\3\.id\)\))(?=;\(0,\i\.A\)\(\{type:\i\.ImpressionTypes.VIEW,name:\i\.ImpressionNames.CHANNEL_CALL_VIDEO_GRID_VIEW)/,
        replace: "$1$self.useGridTiles($5.id,$2,$6,$7,$8)"
    }, {
        match: /(keyExtractor:)(\i)(,paddingTop:64,paddingBottom:64,children:)(\i)(?=\}\))/,
        replace: "$1$self.gridTileKeyExtractor($2,$4)$3$4"
    }]
}, {
    find: CALL_GRID_ROOT_MATCH,
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: CALL_GRID_ROOT_MATCH,
        replace: "$1let dassShowStreamGrid=$self.useHasGridShares($2.id),dassVoiceGrid=!1;"
    }, {
        match: /(\i=\i\?\i:\i,)(\i===\i\._Of.VOICE)(?=\)return\(0,\i\.jsx\)\(\i\.A,\{guildId:\i\.guild_id,width:\i,className:\i\.\i,participants:\i,onContextMenu:\i\}\))/,
        replace: "$1(dassVoiceGrid=$2)&&!dassShowStreamGrid"
    }, {
        match: /if\(null==(\i)\)(?=\{if\(0===\i\.length\))/,
        replace: "if(null==$1||dassShowStreamGrid&&dassVoiceGrid)"
    }, {
        match: /if\(0===(\i)\.length\)(?=\{let \i=\i\.length>0&&!\i;return\(0,\i\.jsx\)\(\i\.A,\{channelId:\i\.id,allPoppedOut:\i\}\))/,
        replace: "if(0===$1.length&&!dassShowStreamGrid)"
    }]
}];

export const DISCORD_PRESENTATION_PATCHES = [{
    find: "handleFullscreenParticipant=",
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(\(0,\i\.jsx\)\()(\i)(,\{)(?=channel:\i,guild:\i,hasConnectPermission:\i,participantsOpen:)/,
        replace: "$1$self.CallView$3dassNativeComponent:$2,dassVideoMode:dassVideoMode,dassPopoutContext:dassPopoutContext,"
    }, {
        match: /(\[(\i)\.BRT.CALL_TILE_POPOUT\]:null\};)/,
        replace: "$1let dassVideoMode=$2._Of.VIDEO,dassPopoutContext=$2.BRT.POPOUT;"
    }, {
        match: /(handleSelectParticipant=\((\i),(\i)\)=>\{)/,
        replace: "$1if($self.selectCallParticipant(this.props.channel.id,$2))return;"
    }, {
        match: /(handleContextMenu=\((\i),\i,\i,\i\)=>\{)/,
        replace: "$1if($self.isDassParticipant($2))return;"
    }, {
        match: /(selectedParticipant:)(\i)(?=,canChangeLayout:\i,canInvite:\i,onToggleChat:\i,maybeLeaveFullScreen:this\.maybeLeaveFullScreen)/,
        replace: "$1$self.nativeParticipant($2)"
    }, {
        match: /(children:\[)(null!=\i&&\i\.type!==\i\.lp\.ACTIVITY&&\i\.user\.id!==\i\?\(0,\i\.jsx\)\(\i\.A,\{context:)/,
        replace: "$1$self.isDassParticipant(this.props.selectedParticipant)?$self.renderCallAudio(this.props.selectedParticipant):$2"
    }, {
        match: /(onSelectParticipant:this\.handleSelectParticipant,onContextMenuParticipant:this\.handleContextMenu,)/,
        replace: "$1onFullscreenParticipant:this.handleFullscreenParticipant,"
    }, {
        match: /(selectedStream:null!=)(\i)(\?\i\.A\.getActiveStreamForStreamKey\(\2\.id\):null)/,
        replace: "$1$self.nativeParticipant($2)$3"
    }, {
        match: /(\(0,\i\.A\)\((\i)\);)(?=let\{participants:\i,filteredParticipants:\i,participantsVersion:\i,mode:\i,layout:\i,participantsOpen:)/,
        replace: "$1let dassCallVideo=$self.useHasGridShares(arguments[0].channel.id)&&!$2;"
    }, {
        match: /(\i=)(\i===\i\._Of.VIDEO)(\?\i:\i\.DUB.MINIMUM)(?=;\i&&\i!==\i\.DUB.FULL_SCREEN)/,
        replace: "$1(dassCallVideo||$2)$3"
    }, {
        match: /(participantsVersion:\i\.A\.getParticipantsVersion\(\i\.id\)\}\},\[)(\i,\i\.id,\i)(\]\))/,
        replace: "$1$2,dassCallVideo$3"
    }]
}, {
    find: /\i=\i\.Ay\.getVideoComponent\(\),\i=\i\.default\.getId\(\),\[\i,\i\]=\i\.useState\(null\)/,
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(selectedParticipant:\i,showParticipants:\i=!0,className:\i,width:\i,height:\i,layout:\i,idle:\i\}=)(\i)(,\i=\i\.Ay\.getVideoComponent\(\))/,
        replace: "$1$self.useFocusedCallProps($2)$3"
    }, {
        match: /(\i=)(!\i&&null!=)(\i)(\.streamId)/,
        replace: "$1$2$3$4||$self.isDassParticipant($3)"
    }]
}, {
    find: '.displayName="CallTile"',
    fromBuild: 634304,
    toBuild: 634304,
    replacement: [{
        match: /(\i=\i\.\$,)(\i=)(\i)(?=\})/,
        replace: "$1$2$self.wrapCallTile($3)"
    }]
}, {
    find: "cropSelfVideo:!1",
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(switch\((\i)\.type\)\{case \i\.lp\.ACTIVITY:return)/,
        replace: 'if($self.isDassParticipant($2))return "\\x02"+$self.dassParticipantTitle($2);$1'
    }, {
        match: /(\(0,\i\.partition\)\(\i,)(\i\.Xw)(\))/,
        replace: "$1participant=>!$self.isDassParticipant(participant)&&$2(participant)$3"
    }]
}, {
    find: /\i\.type===\i\.lp\.STREAM\?\i\.find\(\i=>\i\.type===\i\.lp\.USER/,
    fromBuild: 634304,
    toBuild: 634304,
    replacement: [{
        match: /(function \i\(\i,(\i),\i\)\{return)/,
        replace: "$1 $self.isDassParticipant($2)?[]:"
    }]
}, {
    find: /getCurrentUserActiveStream\(\),\i\.A\.getStreamerActiveStreamMetadata\(\)/,
    fromBuild: 634304,
    toBuild: 634304,
    group: true,
    replacement: [{
        match: /(function (\i)\(\i\)\{let\{streamMetadata:\i,accountLinkUpsellTargetRef:\i,streamQualityIndicator:\i\}=\i)/,
        replace: "$self.setNativeSidebarBody($2);$1"
    }, {
        match: /let\{guildId:(\i),analyticsContext:(\i),className:(\i)\}=(\i)(?=,\i=\i\.useRef\(null\),\i=\i\.useRef\(null\),\i=\i\.useRef\(null\))/,
        replace: "let{guildId:$1,analyticsContext:$2,className:$3,dassSidebar}=$self.useNativeSidebarProps($4)"
    }, {
        match: /(return null==\i)(\?null:\(0,\i\.jsx\)\("div",\{className:\i\(\)\(\i\.\i,\i\),ref:\i,children:)/,
        replace: "$1&&!dassSidebar$2"
    }, {
        match: /(children:\[)(\i)(,\(0,\i\.jsx\)\(\i,\{stream:\i,canGoLive:\i,canGoLiveActivity:)/,
        replace: "$1dassSidebar?$self.renderNativeSidebarBody(dassSidebar.metadata):$2$3"
    }, {
        match: /(\(0,\i\.jsx\)\(\i,)(\{stream:\i,canGoLive:\i,canGoLiveActivity:)/,
        replace: "$1$self.sidebarActionProps($2"
    }, {
        match: /(connectionApp:\i\})(\))(?=,\(0,\i\.jsx\)\(\i,\{popover:)/,
        replace: "$1,dassSidebar)$2"
    }, {
        match: /(?<=,)(\(0,\i\.jsx\)\(\i,\{popover:\i,dismissPopover:)/,
        replace: "dassSidebar?null:$1"
    }, {
        match: /(function\(\i\)\{)(?=let\{stream:\i,canGoLive:\i,canGoLiveActivity:)/,
        replace: "$1let dassStop=arguments[0].dassStop;"
    }, {
        match: /(\i\.useCallback\(\(\)=>\{)(\(0,\i\.A\)\((\i)\))(\},\[\3)(\]\))/,
        replace: "$1$self.stopSidebarStream(dassStop,()=>$2)$4,dassStop$5"
    }, {
        match: /(\i=\(\)=>\{\i\(\),)(\(0,\i\.X\)\(\i,\i\.O\.STREAM,!1\))(?=\},\i=\i\.\i,)/,
        replace: "$1dassStop||$2"
    }, {
        match: /(\(\i\?\?\i\)==null\?\(0,\i\.jsx\)\(\i,\{isActivity:)/,
        replace: "dassStop?null:$1"
    }]
}];

export interface LocalLiveContext {
    pluginActive: boolean;
    publisherPhase: string;
    discordUserId: string;
    localDiscordUserId?: string;
    discordChannelId?: string;
    currentDiscordChannelId?: string;
}

export function isLocalPublisherLive(context: LocalLiveContext): boolean {
    return context.pluginActive && !!context.localDiscordUserId && context.discordUserId === context.localDiscordUserId
        && !!context.currentDiscordChannelId && context.discordChannelId === context.currentDiscordChannelId
        && ["preparing", "prepared", "activating", "publishing"].includes(context.publisherPhase);
}

export const TRANSPORT_UNAVAILABLE_MESSAGE = "DASS transport unavailable.";

export function createShareSelection(signal: AbortSignal, isContextCurrent: () => boolean, nativeStart: () => void, dassStart?: () => void) {
    let consumed = false;
    return (transport: "dass" | "discord" | "cancel") => {
        if (consumed || signal.aborted || !isContextCurrent()) return;
        consumed = true;
        if (transport === "dass") {
            if (dassStart) dassStart();
            else return TRANSPORT_UNAVAILABLE_MESSAGE;
        }
        if (transport === "discord") nativeStart();
    };
}

export type PublishIntent = { transport: "discord"; } | {
    transport: "dass";
    roomId: string;
    capture(signal: AbortSignal): Promise<CaptureLease>;
};

export type WatchIntent = { transport: "discord"; } | { transport: "dass"; share: DassShare; };

export type Interception<T> = { handled: false; } | { handled: true; completion: Promise<RoutingResult<T>>; };

export function routePublish(routing: ScreenshareRouting, intent: PublishIntent): Interception<void> {
    if (intent.transport === "discord") return { handled: false };
    return { handled: true, completion: routing.publish(intent.roomId, intent.capture) };
}

export function routeWatch(routing: ScreenshareRouting, intent: WatchIntent): Interception<MediaStream> {
    if (intent.transport === "discord") return { handled: false };
    return { handled: true, completion: routing.watch(intent.share) };
}
