/**
 * @name AuroraGSI
 * @author Popato, DrMeteor & Aytackydln
 * @description Sends information to Aurora about users connecting to/disconnecting from, mute/deafen status
 *       https://www.project-aurora.com/
 * @version 2.6.7
 * @donate https://github.com/Aurora-RGB/Aurora
 * @website http://www.project-aurora.com/
 * @source https://github.com/Aurora-RGB/Discord-GSI
 * @updateUrl https://raw.githubusercontent.com/Aurora-RGB/Discord-GSI/master/AuroraGSI.plugin.js
 */

const config = {
    // changelog types: "added", "fixed", "removed", "improved"
    changelog: [
        {
            "title": "2.6.7",
            "type": "fixed",
            "items": [
                "Fixed user state (online/idle/dnd/invisible) not updating correctly",
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
const VoiceStateStore = returnStore("VoiceStateStore")
const Dispatcher = returnStore("UserStore")._dispatcher

const getChannel = toSafeFunction(ChannelStore, ChannelStore?.getChannel)

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
                status: '',
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
                type: -1,
                name: '',
                somebody_speaking: false,
            },
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
            this.json.voice.type = voiceChannel.type
            this.json.voice.id = Number.parseInt(voiceChannel.id)
            if (voiceChannel.type === 1) { // call
                this.json.voice.name = getUser(voiceChannel.recipients[0])?.username
            } else if (voiceChannel.type === 2) { // voice channel
                this.json.voice.name = voiceChannel.name
            }
            if (!this.voice.name) {
                this.speakers.clear()
            }
        } else {
            this.json.voice.id = -1
            this.json.voice.type = -1
            this.json.voice.name = ''
            this.speakers.clear()
        }
        this.sendUpdate()
    }

    onVoiceState = () => {
        const voice = {}
        voice.self_mute = isSelfMute()
        voice.self_deafen = isSelfDeaf()
        voice.mute = isMute()
        voice.deafen = isDeaf()
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
        if (userId === getCurrentUser()?.id) {
            if (this.json.user.is_speaking === speakingFlags)
                return
            this.json.user.is_speaking = speakingFlags > 0
            this.sendUpdate()
        } else {
            // check for props.speakingFlags bit 1
            const isSpeaking = (speakingFlags & 1) === 1
            if (isSpeaking) {
                this.speakers.add(userId)
            } else {
                this.speakers.delete(userId)
            }
            const isSomeoneSpeaking = this.speakers.size > 0
            if (this.json.voice.somebody_speaking === isSomeoneSpeaking)
                return
            this.json.voice.somebody_speaking = isSomeoneSpeaking
            this.sendUpdate()
        }
    }

    start() {
        const lastVersion = BdData.load('PingNotification', 'lastVersion');
        if (lastVersion !== this.meta.version) {
            BdUI.showChangelogModal({
                title: this.meta.name,
                subtitle: this.meta.version,
                changes: config.changelog
            });
            BdData.save('PingNotification', 'lastVersion', this.meta.version);
        }

        const user = getCurrentUser()
        const unreadGuilds = Object.values(getMutableGuildStates() ?? {})
            .filter(obj => Object.values(obj).includes(true))
        this.json = {
            provider: {
                name: 'discord',
                appid: -1
            },
            user: {
                id: Number.parseInt(user?.id),
                status: getLocalStatus(),
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
                id: -1,
                type: -1,
                name: '',
                somebody_speaking: false,
            },
            updateTime: Date.now()
        }

        const voiceState = VoiceStateStore.getDiscoverableVoiceStateForUser(user.id)
        const channelId = voiceState?.channelId
        if (channelId){
            this.updateVoiceChannel(channelId);
        }

        this.events.forEach(x => Dispatcher.subscribe(x.eventName, x.method))

        console.log('[AuroraGSI] Started')
        this.sendUpdate()
    }

    stop() {
        this.events.forEach(x => Dispatcher.unsubscribe(x.eventName, x.method))
    }
}
