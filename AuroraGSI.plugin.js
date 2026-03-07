/**
 * @name AuroraGSI
 * @author Popato, DrMeteor & Aytackydln
 * @description Sends information to Aurora about users connecting to/disconnecting from, mute/deafen status
 *       https://www.project-aurora.com/
 * @version 2.7.2
 * @donate https://github.com/Aurora-RGB/Aurora
 * @website http://www.project-aurora.com/
 * @source https://github.com/Aurora-RGB/Discord-GSI
 * @updateUrl https://raw.githubusercontent.com/Aurora-RGB/Discord-GSI/master/AuroraGSI.plugin.js
 */

const config = {
    // changelog types: "added", "fixed", "removed", "improved"
    changelog: [
        {
            "title": "2.7.0",
            "type": "added",
            "items": [
                "Added voice channel participants data and whether they are speaking to the JSON output.",
            ]
        },
        {
            "title": "2.7.1",
            "type": "improved",
            "items": [
                "Improve channel participant updates with user connect/disconnect",
            ]
        },
        {
            "title": "2.7.2",
            "type": "fixed",
            "items": [
                "Fix voice participant muted state not updating with self mute change",
            ]
        },
    ],
}

/**
 * In case the provided argument is not a function, logs an error and returns a no-op function.
 * @param module
 * @param fn
 * @returns {*|(function(): undefined)}
 */
function toSafeFunction(module, fn) {
    if (typeof fn === "function") {
        return fn.bind(module);
    }
    console.error("Expected a function but got:", fn);
    return () => undefined;
}

// bind BdApi modules while keeping TypeScript linter happy
// @ts-ignore
const BdWebpack = BdApi.Webpack
// @ts-ignore
const BdData = BdApi.Data;
// @ts-ignore
const BdUI = BdApi.UI;
const moduleFilters = BdWebpack.Filters

// bind Discord functions
function returnStore(name) {
    return BdWebpack.getStore(name)
}
const ChannelStore = returnStore("ChannelStore");
const SelectedChannelStore = returnStore("SelectedChannelStore")
const VoiceStateStore = returnStore("VoiceStateStore")
const Dispatcher = returnStore("UserStore")._dispatcher

function toModuleFunction(functionName) {
    const modules = BdWebpack.getModules(moduleFilters.byKeys(functionName))
        .filter(m => typeof m[functionName] === 'function')
    if (modules && modules.length > 1) {
        console.warn(`[AuroraGSI] Multiple modules (${modules.length}) found for function ${functionName}, using the first one.`);
    }
    const module = modules ? modules[0] : null;
    if (!module) {
        console.error(`[AuroraGSI] Could not find module for function ${functionName}`);
        return () => undefined;
    }
    return module[functionName].bind(module);
}

const [
    getCalls, getMutableGuildStates, getTotalMentionCount
] = ["getCalls", "getMutableGuildStates", "getTotalMentionCount"]
    .map(toModuleFunction)

// bind Discord functions from modules
const [
    userModule,
    userIdModule,
    muteModule,
    guildModule
] = BdWebpack.getBulk(
    { filter: moduleFilters.byKeys('getUser', 'getCurrentUser') },
    { filter: moduleFilters.byKeys('getUserIds', 'getState', 'getStatus') },
    { filter: moduleFilters.byKeys('isMute', 'isDeaf', 'isSelfMute', 'isSelfDeaf') },
    { filter: moduleFilters.byKeys('getGuild', 'getGuilds') },
)

const getChannel = toSafeFunction(ChannelStore, ChannelStore?.getChannel)
const getUser = toSafeFunction(userModule, userModule?.getUser)
const getCurrentUser = toSafeFunction(userModule, userModule?.getCurrentUser)
const isMute = toSafeFunction(muteModule, muteModule?.isMute)
const isDeaf = toSafeFunction(muteModule, muteModule?.isDeaf)
const isSelfMute = toSafeFunction(muteModule, muteModule?.isSelfMute)
const isSelfDeaf = toSafeFunction(muteModule, muteModule?.isSelfDeaf)
const getGuild = toSafeFunction(guildModule, guildModule?.getGuild)

// too ambiguous function name to use toModuleFunction
function getLocalStatus() {
    const currentUser = getCurrentUser();
    if (!currentUser)
        return null;
    return userIdModule.getStatus(currentUser.id)
}

// Throttle & HTTP functions
/**
 * @param {{ (json: any): Promise<void>; apply?: any; }} func
 * @param {number} wait
 * @param {{ leading?: any; trailing?: any; } | undefined} [options]
 */
function throttle(func, wait, options) {
    let context, args, result
    let timeout = null
    let previous = 0
    if (!options) options = {}
    const later = function () {
        previous = options.leading === false ? 0 : Date.now()
        timeout = null
        result = func.apply(context, args)
        if (!timeout) context = args = null
    }
    return function () {
        const now = Date.now()
        if (!previous && options.leading === false) previous = now
        const remaining = wait - (now - previous)
        context = this
        args = arguments
        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout)
                timeout = null
            }
            previous = now
            result = func.apply(context, args)
            if (!timeout) context = args = null
        } else if (!timeout && options.trailing !== false) {
            timeout = setTimeout(later, remaining)
        }
        return result
    }
}

/**
 * @param {any} json
 */
async function sendJsonToAurora(json) {
    await fetch('http://127.0.0.1:9088/gameState/discord', {
        method: 'POST',
        body: JSON.stringify(json),
        mode: 'no-cors',
        headers: {
            'Content-Type': 'application/json'
        },
        priority: 'high',
    })
        .catch(error => console.warn(`[AuroraGSI] error: `, error))
}

module.exports = class AuroraGSI {
    constructor(meta) {
        this.meta = meta
        this.sendJsonToAurora = throttle(sendJsonToAurora, 100)

        //event names: https://github.com/dorpier/dorpier/wiki/Dispatcher-Events
        this.events = [
            {eventName: 'MESSAGE_CREATE', method: this.onMessage},
            {eventName: 'CHANNEL_SELECT', method: this.onChannelSelected},
            {eventName: 'VOICE_CHANNEL_SELECT', method: this.onVoiceChannelSelect},
            {eventName: 'PRESENCE_UPDATES', method: this.onPresenceUpdate},
            {eventName: 'SPEAKING', method: this.onSpeech},
            {eventName: 'CALL_CREATE', method: this.onCall},
            {eventName: 'VOICE_STATE_UPDATES', method: this.onVoiceState},
        ]

        this.speakers = new Set()
        this.lastMentions = 0
        this.voice = {}
        this.mentions = 0
        this.json = {
            provider: {
                name: 'discord',
                appid: -1
            },
            user: {
                id: -1,
                idString: '-1',
                status: '',
                mute: false,
                deafen: false,
                self_mute: false,
                self_deafen: false,
                mentions: false,
                mention_count: 0,
                unread_guilds_count: 0,
                unread_messages: false,
                being_called: false,
                is_speaking: false,
            },
            guild: {
                id: -1,
                name: ''
            },
            text: {
                id: -1,
                type: -1,
                name: ''
            },
            voice: {
                id: -1,
                idString: '-1',
                type: -1,
                name: '',
                somebody_speaking: false,
            },
            voice_participants: {},
            updateTime: Date.now()
        }
    }

    sendUpdate(){
        this.json.updateTime = Date.now()
        this.sendJsonToAurora(this.json).then()
    }

    onChannelSelected = (props) => {
        const guild = getGuild(props.guildId)
        if (guild) {
            this.json.guild.id = Number.parseInt(guild.id)
            this.json.guild.name = guild.name
        } else {
            this.json.guild.id = -1
            this.json.guild.name = ''
        }
        this.updateVoiceChannel(props.channelId);
        this.sendUpdate()
    }

    updateVoiceChannel(channelId) {
        const textChannel = getChannel(channelId)
        if (textChannel) {
            this.json.text.id = Number.parseInt(textChannel.id)
            this.json.text.type = textChannel.type
            switch (textChannel.type) {
                case 0: // text channel
                    this.json.text.name = textChannel.name
                    break
                case 5: // announcement channel
                    this.json.text.name = textChannel.name
                    break
                case 1: // pm
                    this.json.text.name = getUser(textChannel.recipients[0])?.username
                    break
                case 3: // group pm
                    if (textChannel.name) {
                        this.json.text.name = textChannel.name
                    } else {
                        this.json.text.name = textChannel.recipients.map(u => getUser(u)?.username).join(' ')
                    }
                    break
            }
        } else {
            this.json.text.id = -1
            this.json.text.type = -1
            this.json.text.name = ''
        }
    }

    onVoiceChannelSelect = (props) => {
        const voiceChannel = getChannel(props.channelId)
        if (voiceChannel) {
            let voiceName = ''
            if (voiceChannel.type === 1) { // call
                voiceName = getUser(voiceChannel.recipients[0])?.username
            } else if (voiceChannel.type === 2) { // voice channel
                voiceName = voiceChannel.name
            }
            this.json.voice = {
                type: voiceChannel.type,
                id: Number.parseInt(voiceChannel.id),
                idString: voiceChannel.id,
                name: voiceName,
                somebody_speaking: false,
            }
            this.speakers.clear()
            this.updateVoiceParticipants(voiceChannel.id)
        } else {
            this.json.voice = {
                id: -1,
                idString: '-1',
                type: -1,
                name: '',
                somebody_speaking: false,
            }
            this.speakers.clear()
            this.json.voice_participants = {}
        }
        this.sendUpdate()
    }

    updateVoiceParticipants = (/** @type {string} */ channelIdString) => {
        const idString = this.json.user.idString
        // copy object to avoid mutating the original in the store
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelIdString)
        this.json.voice_participants = Object.fromEntries(
            Object.entries(voiceStates)
                .filter(([key, value]) => {
                    // not current user
                    // in the same channel (users leaving have empty channelId, so they will be filtered out)
                    return key !== idString && value.channelId === channelIdString
                })
        )
    }

    onVoiceState = (props) => {
        let channelId = ''
        let updateParticipants = false
        props.voiceStates.forEach(voiceState => {
            if (voiceState.channelId)
                channelId = voiceState.channelId
            const userId = voiceState.userId

            if (userId === getCurrentUser()?.id) {
                this.onUserVoiceStateUpdate(voiceState);
            }
            else if (voiceState.channelId === this.json.voice.idString) { // current channel update, but not current user, update participants
                updateParticipants = true
            }else if(voiceState.oldChannelId === this.json.voice.idString){    // user left the current channel
                updateParticipants = true
            }
        })
        if (updateParticipants) {
            this.updateVoiceParticipants(channelId)
            this.sendUpdate()
        }
    }

    onUserVoiceStateUpdate = (voiceState) => {
        const voice = {
            self_mute: voiceState.selfMute,
            self_deafen: voiceState.selfDeaf,
            mute: voiceState.mute || voiceState.selfMute,
            deafen: voiceState.deaf || voiceState.selfDeaf,
        }
        if (this.voice.mute === voice.mute && this.voice.deafen === voice.deafen) {
            return
        }
        this.json.user.self_mute = voice.self_mute
        this.json.user.self_deafen = voice.self_deafen
        this.json.user.mute = voice.mute
        this.json.user.deafen = voice.deafen
        this.sendUpdate()
    }

    onMessage = (props) => {
        const uid = getCurrentUser()?.id
        const mentions = getTotalMentionCount() ?? 0
        if (props.message && !props.message.sendMessageOptions && props.message.author.id !== uid && this.mentions !== mentions) {
            this.mentions = mentions
            this.json.user.mentions = mentions > 0
            this.json.user.mention_count = mentions
        }
        const unread = Object.values(getMutableGuildStates() ?? {})
            .filter(obj => Object.values(obj).includes(true))
            .length
        if (mentions === this.lastMentions && unread === this.json.user.unread_guilds_count) {
            return
        }

        this.json.user.unread_messages = unread > 0
        this.json.user.unread_guilds_count = unread

        this.lastMentions = mentions
        this.sendUpdate()
    }

    onPresenceUpdate = (props) => {
        if (!props.updates.some(user => user.user.id === getCurrentUser()?.id)) {
            return
        }
        const localUser = getCurrentUser()
        const localStatus = getLocalStatus()
        this.json.user.id = Number.parseInt(localUser?.id ?? -1)
        if (this.json.user.status === localStatus)
            return
        this.json.user.status = localStatus ?? ''
        this.sendUpdate()
    }

    onCall = () => {
        setTimeout(() => {
            const being_called = getCalls()?.some((x) => x.ringing.length > 0) ?? false
            if (being_called === this.voice.being_called) {
                return;
            }
            this.json.user.being_called = being_called
            this.voice.being_called = being_called
            this.sendUpdate()
        }, 100)
    }

    onSpeech = (props) => {
        const userId = props.userId
        const speakingFlags = props.speakingFlags
        // check for props.speakingFlags bit 1
        const isSpeaking = (speakingFlags & 1) === 1

        if (userId === getCurrentUser()?.id) {
            if (this.json.user.is_speaking === isSpeaking)
                return
            this.json.user.is_speaking = isSpeaking

            this.sendUpdate()
        } else {
            if (isSpeaking) {
                this.speakers.add(userId)
            } else {
                this.speakers.delete(userId)
            }

            if (this.json.voice.id === -1)
                return; // if we are not in a voice channel, ignore
            // update json.voice_participants for the user
            const participantObject = this.json.voice_participants[userId] || {};
            participantObject.is_speaking = isSpeaking;
            this.json.voice_participants[userId] = participantObject;

            this.json.voice.somebody_speaking = this.speakers.size > 0
            this.sendUpdate()
        }
    }

    start() {
        const lastVersion = BdData.load('AuroraGSI', 'lastVersion');
        if (lastVersion !== this.meta.version) {
            BdUI.showChangelogModal({
                title: this.meta.name,
                subtitle: this.meta.version,
                changes: config.changelog
            });
            BdData.save('AuroraGSI', 'lastVersion', this.meta.version);
        }

        const user = getCurrentUser()
        const unreadGuilds = Object.values(getMutableGuildStates() ?? {})
            .filter(obj => Object.values(obj).includes(true))

        const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
        const voiceChannel = getChannel(voiceChannelId)

        this.json = {
            provider: {
                name: 'discord',
                appid: -1
            },
            user: {
                id: Number.parseInt(user?.id),
                idString: user?.id ?? '-1',
                status: getLocalStatus(),
                mute: isMute(),
                deafen: isDeaf(),
                self_mute: isSelfMute(),
                self_deafen: isSelfDeaf(),
                mentions: getTotalMentionCount()?.length > 0,
                mention_count: getTotalMentionCount()?.length ?? 0,
                unread_guilds_count: unreadGuilds.length,
                unread_messages: unreadGuilds.length > 0,
                being_called: false,
                is_speaking: false,
            },
            guild: {
                id: -1,
                name: ''
            },
            text: {
                id: -1,
                type: -1,
                name: ''
            },
            voice: {
                id: voiceChannelId == null ? -1 : Number.parseInt(voiceChannelId),
                idString: voiceChannelId ?? '-1',
                type: voiceChannel?.type ?? -1,
                name: voiceChannel?.name ?? '',
                somebody_speaking: false,
            },
            voice_participants: {},
            updateTime: Date.now()
        }
        this.updateVoiceParticipants(voiceChannelId)

        this.events.forEach(x => Dispatcher.subscribe(x.eventName, x.method))

        console.log('[AuroraGSI] Started')
        this.sendUpdate()
    }

    stop() {
        this.events.forEach(x => Dispatcher.unsubscribe(x.eventName, x.method))
    }
}
