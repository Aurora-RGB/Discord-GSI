/**
 * @name AuroraGSI
 * @invite https://discord.gg/YAuBmg9
 * @website https://www.project-aurora.com/
 * @source https://github.com/th3an7/Discord-GSI/blob/master/AuroraGSI.plugin.js
 */
/*@cc_on
@if (@_jscript)
	
	// Offer to self-install for clueless users that try to run this directly.
	var shell = WScript.CreateObject("WScript.Shell");
	var fs = new ActiveXObject("Scripting.FileSystemObject");
	var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\BetterDiscord\plugins");
	var pathSelf = WScript.ScriptFullName;
	// Put the user at ease by addressing them in the first person
	shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
	if (fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
		shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
	} else if (!fs.FolderExists(pathPlugins)) {
		shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's even installed?", 0, "Can't install myself", 0x10);
	} else if (shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
		fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
		// Show the user where to put plugins in the future
		shell.Exec("explorer " + pathPlugins);
		shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
	}
	WScript.Quit();

@else@*/

module.exports = (() => {
    const config = {"info":{"name":"AuroraGSI","authors":[{"name":"Th3Ant","discord_username":"th3ant","discord_id":"215285737422192640","github_username":"th3an7"},{"name":"Popato","github_username":"Popat0"},{"name":"DrMeteor","github_username":"diogotr7"}],"version":"3.0.0","description":"Sends information to Aurora about users connecting to/disconnecting from, mute/deafen status","github":"https://www.project-aurora.com/","github_raw":"https://github.com/Popat0/Discord-GSI/blob/master/AuroraGSI.plugin.js"},"changelog":[{"title":"Small rewrite","items":["Switched to ZerePluginsLibrary cause NeatoLib is always broken..."]}],"main":"index.js"};

    return !global.ZeresPluginLibrary ? class {
        constructor() {this._config = config;}
        getName() {return config.info.name;}
        getAuthor() {return config.info.authors.map(a => a.name).join(", ");}
        getDescription() {return config.info.description;}
        getVersion() {return config.info.version;}
        load() {
            BdApi.showConfirmationModal("Library Missing", `The library plugin needed for ${config.info.name} is missing. Please click Download Now to install it.`, {
                confirmText: "Download Now",
                cancelText: "Cancel",
                onConfirm: () => {
                    require("request").get("https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js", async (error, response, body) => {
                        if (error) return require("electron").shell.openExternal("https://betterdiscord.net/ghdl?url=https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js");
                        await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), body, r));
                    });
                }
            });
        }
        start() {}
        stop() {}
    } : (([Plugin, Api]) => {
        const plugin = (Plugin, Library) => {
    const {DiscordAPI, DiscordModules, WebpackModules} = Library;
    return class AuroraGSI extends Plugin {

        constructor() {
            super();            
            this.json = {
                "provider": {
                    "name": "discord",
                    "appid": -1
                },
                "user": {
                    "id": -1,
                    "status": "undefined",
                    "self_mute": false,
                    "self_deafen": false,
                    "mentions": false,
                    "unread_messages": false,
                    "being_called": false
                },
                "guild": {
                    "id": -1,
                    "name": "",
                },
                "text": {
                    "id": -1,
                    "type": -1,
                    "name": "",
                },
                "voice": {
                    "id": -1,
                    "type": -1,
                    "name": "",      
                }
            };
            this.lastJson;
        }

        onStart() {
            this.startSending();
        }

        onStop() {
            clearInterval(this.updatetimer);
            // this.unpatch();
            this.ready = false;
        }

        startSending() {
            
            let // getVoiceStates = NeatoLib.Modules.get(["getVoiceState"]).getVoiceStates,
                getUser = DiscordModules.UserStore.getUser,
                getChannel = DiscordModules.ChannelStore.getChannel,
                getCalls = WebpackModules.getByProps(["getCalls"]).getCalls,
                getLanguage = document.documentElement.lang;
            
            // this.jsonTimer = setInterval( this.sendJsonToAurora, 50, this.json );
    
            switch (getLanguage) {
                case "en-US":
                    var mute = '[aria-label="Mute"]';
                    var deafen = '[aria-label="Deafen"]';
                    break;
                case "en-GB":
                    var mute = '[aria-label="Mute"]';
                    var deafen = '[aria-label="Deafen"]';
                    break;
                case "pl":
                    var mute = '[aria-label="Wycisz"]';
                    var deafen = '[aria-label="Wyłącz dźwięk"]';
                    break;
                case "da":
                    var mute = '[aria-label="Gør stum"]';
                    var deafen = '[aria-label="Gør døv"]';
                    break;
                case "de":
                    var mute = '[aria-label="Stummschalten"]';
                    var deafen = '[aria-label="Ein- und Ausgabe deaktivieren"]';
                    break;
                case "es-ES":
                    var mute = '[aria-label="Silenciar"]';
                    var deafen = '[aria-label="Ensordecer"]';
                    break;
                case "fr":
                    var mute = '[aria-label="Rendre muet"]';
                    var deafen = '[aria-label="Mettre en sourdine"]';
                    break;
                case "hr":
                    var mute = '[aria-label="Isključi mikrofon"]';
                    var deafen = '[aria-label="Isključi zvuk"]';
                    break;
                case "it":
                    var mute = '[aria-label="Silenzia"]';
                    var deafen = '[aria-label="Silenzia l\'audio"]';
                    break;
                case "lt":
                    var mute = '[aria-label="Nutildyti"]';
                    var deafen = '[aria-label="Išjungti garsą"]';
                    break;
                case "hu":
                    var mute = '[aria-label="Némítás"]';
                    var deafen = '[aria-label="Süketítés"]';
                    break;
                case "hl":
                    var mute = '[aria-label="Dempen"]';
                    var deafen = '[aria-label="Hoorbaar maken"]';
                    break;
                case "no":
                    var mute = '[aria-label="Demp"]';
                    var deafen = '[aria-label="Slå av lyd"]';
                    break;
                case "pt-BR":
                    var mute = '[aria-label="Desativar microfone"]';
                    var deafen = '[aria-label="Desativar áudio"]';
                    break;
                case "ro":
                    var mute = '[aria-label="Dezactivează microfonul"]';
                    var deafen = '[aria-label="Dezactivează sunetul"]';
                    break;
                case "fi":
                    var mute = '[aria-label="Mykistä"]';
                    var deafen = '[aria-label="Hiljennä"]';
                    break;
                case "sv-SE":
                    var mute = '[aria-label="Mikrofon av"]';
                    var deafen = '[aria-label="Ljud av"]';
                    break;
                case "vi":
                    var mute = '[aria-label="Tắt âm"]';
                    var deafen = '[aria-label="Tắt tiếng"]';
                    break;
                case "tr":
                    var mute = '[aria-label="Sustur"]';
                    var deafen = '[aria-label="Sağırlaştır"]';
                    break;
                case "cs":
                    var mute = '[aria-label="Ztlumit mikrofon"]';
                    var deafen = '[aria-label="Ztlumit zvuk"]';
                    break;
                case "el":
                    var mute = '[aria-label="Σίγαση"]';
                    var deafen = '[aria-label="Κώφωση"]';
                    break;
                case "bg":
                    var mute = '[aria-label="Изкл. на микрофона"]';
                    var deafen = '[aria-label="Заглушаване"]';
                    break;
                case "ru":
                    var mute = '[aria-label="Откл. микрофон"]';
                    var deafen = '[aria-label="Откл. звук"]';
                    break;
                case "uk":
                    var mute = '[aria-label="Вимкнути мікрофон"]';
                    var deafen = '[aria-label="Вимкнути звук"]';
                    break;
                case "th":
                    var mute = '[aria-label="ปิดเสียง"]';
                    var deafen = '[aria-label="ปิดการได้ยิน"]';
                    break;
                case "zh-CN":
                    var mute = '[aria-label="麦克风静音"]';
                    var deafen = '[aria-label="耳机静音"]';
                    break;
                case "ja":
                    var mute = '[aria-label="ミュート"]';
                    var deafen = '[aria-label="スピーカーミュート"]';
                    break;
                case "zh-TW":
                    var mute = '[aria-label="靜音"]';
                    var deafen = '[aria-label="拒聽"]';
                    break;
                case "ko":
                    var mute = '[aria-label="마이크 음소거 "]';
                    var deafen = '[aria-label="헤드셋 음소거 "]';
                    break;
                default:
                    console.log("Something is fucked up... can't find language");
            }
    
            this.updatetimer = setInterval(() => { 
                var self = this;
                
                var guild = DiscordAPI.currentGuild;
                var localUser = DiscordAPI.currentUser;
                var textChannel = DiscordAPI.currentChannel;
                var voiceChannel = getChannel(DiscordModules.SelectedChannelStore.getVoiceChannelId());
                if (voiceChannel) {
                    // var voiceStates = getVoiceStates(voiceChannel.guild_id);
                }
                if (localUser) {
                    self.json.user.id = localUser.id;
                    self.json.user.status = localUser.status;
                }
                else {
                    self.json.user.id = -1;
                    self.json.user.status = "";
                }
    
                if (guild) {
                    self.json.guild.id = guild.id;
                    self.json.guild.name = guild.name;
                }
                else {
                    self.json.guild.id = -1;
                    self.json.guild.name = "";
                }
    
                if (textChannel) {
                    self.json.text.id = textChannel.id;
                    if (textChannel.type === 'GUILD_TEXT') {// text channel
                        self.json.text.type = 0;
                        self.json.text.name = textChannel.name;
                    }
                    else if (textChannel.type === 'DM') {// pm
                        self.json.text.type = 1;
                        self.json.text.name = getUser(getChannel(textChannel.id).recipients).username;
                    }
                    else if (textChannel.type === 'GROUP_DM') {// group pm
                        self.json.text.type = 3;
                        if (textChannel.name) {
                            self.json.text.name = textChannel.name;
                        }
                        else {
                            let newname = "";
                            for (let i = 0; i < getChannel(textChannel.id).recipients.length; i++) {
                                let user = getChannel(textChannel.id).recipients[i];
                                newname += getUser(user).username + " ";
                            }
                            self.json.text.name = newname;
                        }
                    }
                }
                else {
                    self.json.text.id = -1;
                    self.json.text.type = -1;
                    self.json.text.name = "";
                }
    
                if (voiceChannel) {
                    if (voiceChannel.type === 1) {// call
                        self.json.voice.type = 1;
                        self.json.voice.id = voiceChannel.id;
                        self.json.voice.name = getUser(voiceChannel.recipients[0]).username;
                    }
                    else if (voiceChannel.type === 2) {// voice channel
                        self.json.voice.type = 2;
                        self.json.voice.id = voiceChannel.id;
                        self.json.voice.name = voiceChannel.name;
                    }
                }
                else {
                    self.json.voice.id = -1;
                    self.json.voice.type = -1;    
                    self.json.voice.name = "";
                }
    
                self.json.user.self_mute = document.querySelector(mute).getAttribute("aria-checked");
                self.json.user.self_deafen = document.querySelector(deafen).getAttribute("aria-checked");
                
            self.json.user.unread_messages = false;
            self.json.user.mentions = false;
            self.json.user.being_called = false;
            
            if (document.querySelector('[class^="numberBadge-"]')) {
                self.json.user.mentions = true;
            }
                if (Object.values(WebpackModules.getByProps('getUnreadGuilds').getUnreadGuilds()).length > 0) {
                    self.json.user.unread_messages = true;
                }
                if (getCalls().filter(function(x) {return x.ringing.length > 0;}).length > 0) {
                    self.json.user.being_called = true;
                }
                if (JSON.stringify(this.json) !== this.lastJson) {
                    console.log("false");
                    this.lastJson = JSON.stringify(this.json);
                    this.sendJsonToAurora(this.json);
                }
            }, 100);
        }
    
        async sendJsonToAurora(json) {
            fetch('http://localhost:9088/', {
                method: 'POST',
                body: JSON.stringify(json),
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .catch(error => {
                return undefined;
            });
        }
    };
};
        return plugin(Plugin, Api);
    })(global.ZeresPluginLibrary.buildPlugin(config));
})();
/*@end@*/
