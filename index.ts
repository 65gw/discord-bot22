import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    TextChannel,
    EmbedBuilder,
    MessageFlags
} from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    VoiceConnectionStatus, 
    getVoiceConnection
} from '@discordjs/voice';
import http from 'http';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '';
const TARGET_VOICE_CHANNEL_ID = process.env.TARGET_VOICE_CHANNEL_ID || '';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

const audioPlayer = createAudioPlayer();
let isChatRespondingEnabled = true;
let isAutoTopicsEnabled = true;
let isVoiceResponseEnabled = true;

const commands = [
    new SlashCommandBuilder()
        .setName('chat-toggle')
        .setDescription('تفعيل أو تعطيل ردود الشات التلقائية'),
    new SlashCommandBuilder()
        .setName('topics-toggle')
        .setDescription('تفعيل أو تعطيل مواضيع الـ 12 ساعة التلقائية'),
    new SlashCommandBuilder()
        .setName('voice-toggle')
        .setDescription('تفعيل أو تعطيل تحويل الردود إلى صوت'),
    new SlashCommandBuilder()
        .setName('speak')
        .setDescription('نطق نص معين داخل الروم الصوتي')
        .addStringOption(option => 
            option.setName('text')
                .setDescription('النص المراد نطقه')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('عرض حالة إعدادات البوت الحالية')
].map(command => command.toJSON());

async function registerCommands() {
    try {
        if (!BOT_TOKEN || !CLIENT_ID) return;
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ تم تسجيل أوامر Slash بنجاح.');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
}

async function sendLogEmbed(embed: EmbedBuilder) {
    try {
        if (!LOG_CHANNEL_ID) return;
        const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (channel && channel.isTextBased()) {
            await (channel as TextChannel).send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('خطأ في إرسال اللوق:', err);
    }
}

function joinAndKeepVoice() {
    try {
        if (!TARGET_VOICE_CHANNEL_ID) return null;
        
        const guild = client.guilds.cache.first();
        if (!guild) return null;

        const existingConnection = getVoiceConnection(guild.id);
        if (existingConnection && existingConnection.joinConfig.channelId === TARGET_VOICE_CHANNEL_ID) {
            return existingConnection;
        }

        const voiceChannel = guild.channels.cache.get(TARGET_VOICE_CHANNEL_ID);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) return null;

        const connection = joinVoiceChannel({
            channelId: TARGET_VOICE_CHANNEL_ID,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        connection.subscribe(audioPlayer);

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('🟢 البوت متصل ومستقر في الروم الصوتي.');
        });

        return connection;
    } catch (error) {
        console.error('❌ خطأ في الاتصال الصوتي:', error);
        return null;
    }
}

async function playTextToSpeech(text: string) {
    if (!isVoiceResponseEnabled) return;
    try {
        joinAndKeepVoice();
        const cleanText = text.replace(/[*_~`#]/g, '').slice(0, 200);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${encodeURIComponent(cleanText)}`;
        const resource = createAudioResource(ttsUrl);
        audioPlayer.play(resource);
    } catch (err) {
        console.error('TTS Error:', err);
    }
}

client.once('ready', async () => {
    console.log(`🤖 تم تسجيل الدخول كـ ${client.user?.tag}`);
    await registerCommands();
    
    joinAndKeepVoice();

    setInterval(() => {
        joinAndKeepVoice();
    }, 30000);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'chat-toggle') {
        isChatRespondingEnabled = !isChatRespondingEnabled;
        await interaction.reply({ 
            content: `تم ${isChatRespondingEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} ردود الشات التلقائية.`, 
            flags: MessageFlags.Ephemeral 
        });
    } 
    else if (commandName === 'topics-toggle') {
        isAutoTopicsEnabled = !isAutoTopicsEnabled;
        await interaction.reply({ 
            content: `تم ${isAutoTopicsEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} مواضيع الـ 12 ساعة التلقائية.`, 
            flags: MessageFlags.Ephemeral 
        });
    }
    else if (commandName === 'voice-toggle') {
        isVoiceResponseEnabled = !isVoiceResponseEnabled;
        await interaction.reply({ 
            content: `تم ${isVoiceResponseEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} تحويل ردود الذكاء الاصطناعي لصوت في الروم الصوتي.`, 
            flags: MessageFlags.Ephemeral 
        });
    }
    else if (commandName === 'speak') {
        const textToSpeak = interaction.options.getString('text', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await playTextToSpeech(textToSpeak);
        await interaction.editReply({ content: `🗣️ جاري نطق النص في الروم الصوتي: "${textToSpeak}"` });
    }
    else if (commandName === 'status') {
        const statusMsg = `**حالة نظام البوت المساعد:**
• ردود الشات: ${isChatRespondingEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• مواضيع الـ 12 ساعة: ${isAutoTopicsEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• القراءة الصوتية (TTS): ${isVoiceResponseEnabled ? '🟢 مفعلة' : '🔴 معطلة'}`;
        await interaction.reply({ content: statusMsg, flags: MessageFlags.Ephemeral });
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member?.id === client.user?.id) {
        if (!newState.channelId || newState.channelId !== TARGET_VOICE_CHANNEL_ID) {
            setTimeout(() => {
                joinAndKeepVoice();
            }, 2000);
        }
        return;
    }

    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    if (!oldState.channelId && newState.channelId) {
        const embed = new EmbedBuilder()
            .setColor('#57f287')
            .setAuthor({ name: `دخول روم صوتي - ${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
            .addFields(
                { name: 'العضو', value: `${member.user}`, inline: true },
                { name: 'الروم الصوتي', value: `<#${newState.channelId}>`, inline: true },
                { name: 'الأيدي', value: `\`${member.id}\``, inline: true }
            )
            .setTimestamp();
        sendLogEmbed(embed);
    } else if (oldState.channelId && !newState.channelId) {
        const embed = new EmbedBuilder()
            .setColor('#ed4245')
            .setAuthor({ name: `خروج من روم صوتي - ${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
            .addFields(
                { name: 'العضو', value: `${member.user}`, inline: true },
                { name: 'الروم الصوتي', value: `<#${oldState.channelId}>`, inline: true },
                { name: 'الأيدي', value: `\`${member.id}\``, inline: true }
            )
            .setTimestamp();
        sendLogEmbed(embed);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const embed = new EmbedBuilder()
            .setColor('#fee75c')
            .setAuthor({ name: `انتقال بين رومات صوتية - ${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
            .addFields(
                { name: 'العضو', value: `${member.user}`, inline: true },
                { name: 'من', value: `<#${oldState.channelId}>`, inline: true },
                { name: 'إلى', value: `<#${newState.channelId}>`, inline: true }
            )
            .setTimestamp();
        sendLogEmbed(embed);
    }
});

// خادم HTTP وهمي لمنع Render من إغلاق البوت
const PORT = process.env.PORT || 3000;
http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot is online!");
    res.end();
}).listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});

client.login(BOT_TOKEN);
