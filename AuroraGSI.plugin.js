/**
 * @name AuroraGSI
 * @author Popato, DrMeteor & Aytackydln
 * @description Sends information to Aurora about users connecting to/disconnecting from, mute/deafen status
 *       https://www.project-aurora.com/
 * @version 2.5.1
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

function returnModule(props) {
  return BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps(props), {first: true})
}

const currentUserModule = returnModule(['getCurrentUser']);
const applicationActivityModule = returnModule(['getApplicationActivity']);
const channelModule = returnModule(['getChannel']);
const guildCountModule = returnModule(['getGuildCount']);
const fluxModule = returnModule(['wait']);
const userModule = returnModule(['getUser']);
const muteModule = returnModule(['isMute']);
const callsModule = returnModule(['getCalls']);
const mutableGuildStatesModule = returnModule(['getMutableGuildStates']);
const totalMentionCountModule = returnModule(['getTotalMentionCount']);
const userIdModule = returnModule(['getUserIds']);

module.exports = class AuroraGSI {
  constructor() {
    this.sendJsonToAurora = global._.debounce(this.sendJsonToAurora, 100);
  }

  getLocalStatus() {
    return userIdModule.getStatus(this.getCurrentUser().id);
  }

  start() {
    this.getCurrentUser = currentUserModule.getCurrentUser;
    this.getStatus = applicationActivityModule.getStatus;
    this.getChannel = channelModule.getChannel;
    this.getGuild = guildCountModule.getGuild;
    this.FluxDispatcher = fluxModule;
    const {getUser} = userModule,
      {getCalls} = callsModule,
      {getMutableGuildStates: getUnreadGuilds} = mutableGuildStatesModule,
      {getTotalMentionCount} = totalMentionCountModule,
      isMute = muteModule.isMute.bind(muteModule),
      isDeaf = muteModule.isDeaf.bind(muteModule),
      isSelfMute = muteModule.isSelfMute.bind(muteModule),
      isSelfDeaf = muteModule.isSelfDeaf.bind(muteModule);

    this.json = {
      provider: {
        name: 'discord',
        appid: -1
      },
      user: {
        id: this.getCurrentUser()?.id,
        status: this.getLocalStatus,
        self_mute: isSelfMute(),
        self_deafen: isSelfDeaf(),
        mentions: getTotalMentionCount().length > 0,
        mention_count: getTotalMentionCount().length,
        unread_guilds_count: Object.values(getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length,
        unread_messages: Object.values(getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length > 0,
        being_called: false
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
        name: ''
      },
      updateTime: new Date().getTime()
    };

    this.handler = (props) => {
      switch (props.type) {
        case 'PRESENCE_UPDATES':
          const localUser = this.getCurrentUser();
          const localStatus = this.getLocalStatus();
          if (localUser && localStatus) {
            this.json.user.id = localUser?.id;
            this.json.user.status = localStatus;
          } else {
            this.json.user.id = -1;
            this.json.user.status = '';
          }
          break;

        case 'CHANNEL_SELECT':
          const guild = this.getGuild(props.guildId);
          if (guild) {
            this.json.guild.id = guild.id;
            this.json.guild.name = guild.name;
          } else {
            this.json.guild.id = -1;
            this.json.guild.name = '';
          }
          const textChannel = this.getChannel(props.channelId);
          if (textChannel) {
            this.json.text.id = textChannel.id;
            this.json.text.type = textChannel.type;
            switch (textChannel.type) {
              case 0: // text channel
                this.json.text.name = textChannel.name;
                break;
              case 5: // announcement channel
                this.json.text.name = textChannel.name;
                break;
              case 1: // pm
                this.json.text.name = getUser(textChannel.recipients[0]).username;
                break;
              case 3: // group pm
                if (textChannel.name) {
                  this.json.text.name = textChannel.name;
                } else {
                  this.json.text.name = textChannel.recipients.map(u => getUser(u).username).join(' ');
                }
                break;
            }
          } else {
            this.json.text.id = -1;
            this.json.text.type = -1;
            this.json.text.name = '';
          }
          break;

        case 'VOICE_CHANNEL_SELECT':
          const voiceChannel = this.getChannel(props.channelId);
          if (voiceChannel) {
            this.json.voice.type = voiceChannel.type;
            this.json.voice.id = voiceChannel.id;
            if (voiceChannel.type === 1) { // call
              this.json.voice.name = getUser(voiceChannel.recipients[0]).username;
            } else if (voiceChannel.type === 2) { // voice channel
              this.json.voice.name = voiceChannel.name;
            }
          } else {
            this.json.voice.id = -1;
            this.json.voice.type = -1;
            this.json.voice.name = '';
          }
          break;
        case 'USER_VOICE_UPDATE':
          this.json.user.self_mute = props.self_mute;
          this.json.user.self_deafen = props.self_deafen;
          this.json.user.mute = props.mute;
          this.json.user.deafen = props.deafen;
          break;
        case 'UNREADS_UPDATE':
          this.json.user.unread_messages = props.unreads > 0;
          this.json.user.unread_guilds_count = props.unreads;
          break;
        case 'MENTIONS_UPDATE':
          this.json.user.mentions = props.mentions > 0;
          this.json.user.mention_count = props.mentions;
          break;
        case 'CALL_RING_UPDATE':
          this.json.user.being_called = props.being_called;
          break;
        default:
          return
      }

      this.json.updateTime = new Date().getTime();
      this.sendJsonToAurora(this.json).then();
    };

    this.detectVoiceState = () => {
      const voice = {};
      voice.self_mute = isSelfMute();
      voice.self_deafen = isSelfDeaf();
      voice.mute = isMute();
      voice.deafen = isDeaf();
      if (this.voice.mute !== voice.mute || this.voice.deafen !== voice.deafen) {
        this.handler({
          type: 'USER_VOICE_UPDATE',
          ...voice
        });
        Object.assign(this.voice, voice);
      }
    };

    this.detectMention = (props) => {
      const uid = this.getCurrentUser()?.id;
      const mentions = getTotalMentionCount();
      if (props.message && !props.message.sendMessageOptions && props.message.author.id !== uid && this.mentions !== mentions) {
        this.handler({
          type: 'MENTIONS_UPDATE',
          mentions
        });
        this.mentions = mentions;
      }
      const unreads = Object.values(getUnreadGuilds()).filter(obj => Object.values(obj).includes(true)).length;
      if (unreads !== this.unreads) {
        this.handler({
          type: 'UNREADS_UPDATE',
          unreads
        });
        this.unreads = unreads;
      }
    };

    this.detectPresence = (props) => {
      if (props.updates.filter(user => user.user.id === this.getCurrentUser()?.id)) {
        this.handler(props);
      }
    };

    this.detectCall = () => {
      setTimeout(() => {
        const being_called = (getCalls().filter((x) => x.ringing.length > 0).length > 0);
        if (being_called !== this.voice.being_called) {
          this.handler({
            type: 'CALL_RING_UPDATE',
            being_called
          });
          this.voice.being_called = being_called;
        }
      }, 100);
    };
    Promise.all([
      this.FluxDispatcher.subscribe('MESSAGE_CREATE', this.detectMention),
      this.FluxDispatcher.subscribe('CHANNEL_SELECT', this.handler),
      this.FluxDispatcher.subscribe('VOICE_CHANNEL_SELECT', this.handler),
      this.FluxDispatcher.subscribe('PRESENCE_UPDATES', this.detectPresence),
      this.FluxDispatcher.subscribe('CALL_CREATE', this.detectCall),
      this.FluxDispatcher.subscribe('VOICE_STATE_UPDATES', this.detectVoiceState),
    ]).then();
    this.voice = {};
    this.unreads = 0;
    this.mentions = 0;
  }

  stop() {
    this.ready = false;
    Promise.all([
      this.FluxDispatcher.unsubscribe('MESSAGE_CREATE', this.detectMention),
      this.FluxDispatcher.unsubscribe('CHANNEL_SELECT', this.handler),
      this.FluxDispatcher.unsubscribe('VOICE_CHANNEL_SELECT', this.handler),
      this.FluxDispatcher.unsubscribe('PRESENCE_UPDATES', this.detectPresence),
      this.FluxDispatcher.unsubscribe('CALL_CREATE', this.detectCall),
      this.FluxDispatcher.unsubscribe('VOICE_STATE_UPDATES', this.detectVoiceState),
    ]).then();
  }

  async sendJsonToAurora(json) {
    await fetch('http://localhost:9088/', {
      method: 'POST',
      body: JSON.stringify(json),
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .catch(error => console.warn(`Aurora GSI error: ${error}`));
  }
};
