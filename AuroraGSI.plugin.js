/**
 * @name AuroraGSI
 * @author Popato, DrMeteor & Aytackydln
 * @description Sends information to Aurora about users connecting to/disconnecting from, mute/deafen status
 *       https://www.project-aurora.com/
 * @version 2.6.2
 * @donate https://github.com/Aurora-RGB/Aurora
 * @website http://www.project-aurora.com/
 * @source https://github.com/Aurora-RGB/Discord-GSI
 * @updateUrl https://raw.githubusercontent.com/Aurora-RGB/Discord-GSI/master/AuroraGSI.plugin.js
 */

/*@cc_on
@if (@_jscript)

    // Offer to self-install for clueless users that try to run this directly.
    var shell = WScript.CreateObject("WScript.Shell");
    var fs = new ActiveXObject("Scripting.FileSystemObject");
    var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%BetterDiscordplugins");
    var pathSelf = WScript.ScriptFullName;
    // Put the user at ease by addressing them in the first person
    shell.Popup("It looks like you've mistakenly tried to run me directly.
't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
    if (fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
        shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
    } else if (!fs.FolderExists(pathPlugins)) {
        shell.Popup("I can't find the BetterDiscord plugins folder.
you sure it's even installed?", 0, "Can't install myself", 0x10);
    } else if (shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
        fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
        // Show the user where to put plugins in the future
        shell.Exec("explorer " + pathPlugins);
        shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
    }
    WScript.Quit();
@else@*/

function returnModuleInstant(props) {
  return BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps(props), {first: true})
}

async function returnModule(props) {
  return await BdApi.Webpack.waitForModule(BdApi.Webpack.Filters.byProps(props), {first: true})
}

async function returnStore(name) {
  return await BdApi.Webpack.getStore(name)
}

const fluxModule = returnModule(['wait']);
const userModule = returnModule(['getUser']);
const muteModule = returnModule(['isMute']);
const callsModule = returnModule(['getCalls']);
const mutableGuildStatesModule = returnModule(['getMutableGuildStates']);
const totalMentionCountModule = returnModule(['getTotalMentionCount']);
const userIdModule = returnModuleInstant(['getUserIds']);

function throttle(func, wait, options) {
  let context, args, result;
  let timeout = null;
  let previous = 0;
  if (!options) options = {};
  const later = function () {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };
  return function() {
    const now = Date.now();
    if (!previous && options.leading === false) previous = now;
    const remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
}

module.exports = class AuroraGSI {
  constructor() {
    this.sendJsonToAurora = throttle(this.sendJsonToAurora, 100);

    //event names: https://github.com/dorpier/dorpier/wiki/Dispatcher-Events
    this.events = [
      {eventName: 'MESSAGE_CREATE', method: this.detectMessage},
      {eventName: 'CHANNEL_SELECT', method: this.detectChannelSelect},
      {eventName: 'VOICE_CHANNEL_SELECT', method: this.detectVoiceChannelSelect},
      {eventName: 'PRESENCE_UPDATES', method: this.detectPresence},
      {eventName: 'SPEAKING', method: this.detectSpeech},
      {eventName: 'CALL_CREATE', method: this.detectCall},
      {eventName: 'VOICE_STATE_UPDATES', method: this.detectVoiceState},
    ]
  }

  async getLocalStatus() {
    if (userIdModule?.getState){
      return userIdModule.getState(this.getCurrentUser().id);
    }
  }

  detectChannelSelect = (props) => {
    console.log('[AuroraGSI] channel select')
    const guild = this.getGuild(props.guildId);
    if (guild) {
      this.json.guild.id = parseInt(guild.id);
      this.json.guild.name = guild.name;
    } else {
      this.json.guild.id = -1;
      this.json.guild.name = '';
    }
    const textChannel = this.getChannel(props.channelId);
    if (textChannel) {
      this.json.text.id = parseInt(textChannel.id);
      this.json.text.type = textChannel.type;
      switch (textChannel.type) {
        case 0: // text channel
          this.json.text.name = textChannel.name;
          break;
        case 5: // announcement channel
          this.json.text.name = textChannel.name;
          break;
        case 1: // pm
          this.json.text.name = this.getUser(textChannel.recipients[0]).username;
          break;
        case 3: // group pm
          if (textChannel.name) {
            this.json.text.name = textChannel.name;
          } else {
            this.json.text.name = textChannel.recipients.map(u => this.getUser(u).username).join(' ');
          }
          break;
      }
    } else {
      this.json.text.id = -1;
      this.json.text.type = -1;
      this.json.text.name = '';
    }
    this.sendUpdate();
  }

  detectVoiceChannelSelect = (props) => {
    console.log('[AuroraGSI] voice channel select')
    const voiceChannel = this.getChannel(props.channelId);
    if (voiceChannel) {
      this.json.voice.type = voiceChannel.type;
      this.json.voice.id = parseInt(voiceChannel.id);
      if (voiceChannel.type === 1) { // call
        this.json.voice.name = this.getUser(voiceChannel.recipients[0]).username;
      } else if (voiceChannel.type === 2) { // voice channel
        this.json.voice.name = voiceChannel.name;
      }
      if (!this.voice.name){
        this.speakers.clear();
      }
    } else {
      this.json.voice.id = -1;
      this.json.voice.type = -1;
      this.json.voice.name = '';
    }
    this.sendUpdate();
  }

  detectVoiceState = () => {
    console.log('[AuroraGSI] voice state')
    const voice = {};
    voice.self_mute = this.isSelfMute();
    voice.self_deafen = this.isSelfDeaf();
    voice.mute = this.isMute();
    voice.deafen = this.isDeaf();
    if (this.voice.mute === voice.mute && this.voice.deafen === voice.deafen) {
      return;
    }
    this.json.user.self_mute = voice.self_mute;
    this.json.user.self_deafen = voice.self_deafen;
    this.json.user.mute = voice.mute;
    this.json.user.deafen = voice.deafen;
    this.sendUpdate();
  };

  detectMessage = (props) => {
    const uid = this.getCurrentUser()?.id;
    const mentions = this.getTotalMentionCount();
    if (props.message && !props.message.sendMessageOptions && props.message.author.id !== uid && this.mentions !== mentions) {
      this.mentions = mentions;
      this.json.user.mentions = mentions > 0;
      this.json.user.mention_count = mentions;
    }
    const unread = Object.values(this.getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length;
    this.json.user.unread_messages = unread > 0;
    this.json.user.unread_guilds_count = unread;

    if (mentions === this.lastMentions && unread === this.lastUnread) {
      return;
    }
    this.lastMentions = mentions;
    this.lastUnread = unread;
    console.log('[AuroraGSI] message')
    this.sendUpdate();
  };

  detectPresence = (props) => {
    if (!props.updates.some(user => user.user.id === this.getCurrentUser()?.id)) {
      return;
    }
    console.log('[AuroraGSI] presence')
    const localUser = this.getCurrentUser();
    const localStatus = this.getLocalStatus();
    this.json.user.id = parseInt(localUser?.id ?? -1);
    if (this.json.user.status === localStatus)
      return;
    this.json.user.status = localStatus ?? '';
    this.sendUpdate();
  };

  detectCall = () => {
    console.log('[AuroraGSI] call')
    setTimeout(() => {
      const being_called = (this.getCalls().filter((x) => x.ringing.length > 0).length > 0);
      if (being_called !== this.voice.being_called) {
        this.json.user.being_called = being_called;
        this.voice.being_called = being_called;
        this.sendUpdate();
      }
    }, 100);
  };

  detectSpeech = (props) => {
    if (props.userId === this.getCurrentUser()?.id) {
      if (this.json.user.is_speaking === props.speakingFlags)
        return;
      this.json.user.is_speaking = props.speakingFlags > 0;
      this.sendUpdate();
    } else {
      if (props.speakingFlags === 1) {
        this.speakers.add(props.userId)
      } else {
        this.speakers.delete(props.userId)
      }
      console.log("[AuroraGSI] speakers: ", this.speakers)
      const isSomeoneSpeaking = this.speakers.size > 0;
      if (this.json.voice.somebody_speaking === isSomeoneSpeaking)
        return;
      this.json.voice.somebody_speaking = isSomeoneSpeaking;
      this.sendUpdate();
    }
  }

  async start() {
    returnModule(['getCurrentUser']).then(currentUserModule => {
      this.getCurrentUser = currentUserModule.getCurrentUser;
    });

    returnStore('ChannelStore').then(channelModule => {
      this.getChannel = channelModule.getChannel;
    })

    returnModule(['getGuildCount']).then(guildCountModule => {
      this.getGuild = guildCountModule.getGuild;
    })

    this.FluxDispatcher = await fluxModule;
    const {getUser} = await userModule,
      {getCalls} = await callsModule,
      {getMutableGuildStates: getUnreadGuilds} = await mutableGuildStatesModule,
      {getTotalMentionCount} = await totalMentionCountModule,
      isMute = (await muteModule).isMute.bind(await muteModule),
      isDeaf = (await muteModule).isDeaf.bind(await muteModule),
      isSelfMute = (await muteModule).isSelfMute.bind(await muteModule),
      isSelfDeaf = (await muteModule).isSelfDeaf.bind(await muteModule);

    //console.log('[AuroraGSI] voiceChannelModule', await voiceChannelModule)

    this.getUser = getUser;
    this.getCalls = getCalls;
    this.getUnreadGuilds = getUnreadGuilds;
    this.getTotalMentionCount = getTotalMentionCount;
    this.isMute = isMute;
    this.isDeaf = isDeaf;
    this.isSelfMute = isSelfMute;
    this.isSelfDeaf = isSelfDeaf;

    this.lastMentions = 0;
    this.lastUnread = 0;

    this.speakers = new Set();

    this.json = {
      provider: {
        name: 'discord',
        appid: -1
      },
      user: {
        id: parseInt(this.getCurrentUser()?.id),
        status: this.getLocalStatus(),
        self_mute: this.isSelfMute(),
        self_deafen: this.isSelfDeaf(),
        mentions: this.getTotalMentionCount().length > 0,
        mention_count: this.getTotalMentionCount().length,
        unread_guilds_count: Object.values(this.getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length,
        unread_messages: Object.values(this.getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length > 0,
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
      updateTime: new Date().getTime()
    };

    this.sendUpdate = () => {
      this.json.updateTime = new Date().getTime();
      this.sendJsonToAurora(this.json).then();
    };

    this.events.forEach(x => this.FluxDispatcher.subscribe(x.eventName, x.method))

    this.voice = {};
    this.mentions = 0;
  }
  stop() {
    this.ready = false;
    this.events.forEach(x => this.FluxDispatcher.unsubscribe(x.eventName, x.method))
  }

  async sendJsonToAurora(json) {
    await fetch('http://localhost:9088/gameState/discord', {
      method: 'POST',
      body: JSON.stringify(json),
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      priority: 'high',
    })
      .catch(error => console.warn(`Aurora GSI error: `, error));
  }
};
