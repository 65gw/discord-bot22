import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    TextChannel,
    EmbedBuilder,
    MessageFlags,
    AttachmentBuilder
} from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    VoiceConnectionStatus, 
    getVoiceConnection,
    entersState
} from '@discordjs/voice';
import http from 'http';
import axios from 'axios';

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

// ==========================================
// 1. تسجيل الأوامر (Slash Commands)
// ==========================================
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
        .setName('download')
        .setDescription('تحميل المقطع وإرفاقه بشكل مباشر كملف فيديو')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('رابط مقطع TikTok')
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
        console.log('✅ تم تسجيل جميع أوامر Slash بنجاح.');
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

// ==========================================
// 2. إدارة الاتصال الصوتي المستمر
// ==========================================
async function joinAndKeepVoice() {
    try {
        if (!TARGET_VOICE_CHANNEL_ID) return null;

        const voiceChannel = await client.channels.fetch(TARGET_VOICE_CHANNEL_ID).catch(() => null);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) return null;

        const guild = voiceChannel.guild;
        const existingConnection = getVoiceConnection(guild.id);

        if (existingConnection && existingConnection.joinConfig.channelId === TARGET_VOICE_CHANNEL_ID) {
            if (existingConnection.state.status === VoiceConnectionStatus.Ready) {
                return existingConnection;
            }
        }

        const connection = joinVoiceChannel({
            channelId: TARGET_VOICE_CHANNEL_ID,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        connection.subscribe(audioPlayer);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
            } catch (e) {
                connection.destroy();
                setTimeout(() => joinAndKeepVoice(), 2000);
            }
        });

        return connection;
    } catch (error) {
        console.error('❌ خطأ أثناء الانضمام للروم الصوتي:', error);
        return null;
    }
}

async function playTextToSpeech(text: string) {
    if (!isVoiceResponseEnabled) return;
    try {
        await joinAndKeepVoice();
        const cleanText = text.replace(/[*_~`#]/g, '').slice(0, 200);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${encodeURIComponent(cleanText)}`;
        const resource = createAudioResource(ttsUrl);
        audioPlayer.play(resource);
    } catch (err) {
        console.error('TTS Error:', err);
    }
}

// ==========================================
// 3. الأحداث والتفاعل مع الأوامر
// ==========================================
client.once('ready', async () => {
    console.log(`🤖 تم تسجيل الدخول كـ ${client.user?.tag}`);
    await registerCommands();
    
    setTimeout(async () => {
        await joinAndKeepVoice();
    }, 3000);

    setInterval(async () => {
        await joinAndKeepVoice();
    }, 15000);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'download') {
        await interaction.deferReply();
        const url = interaction.options.getString('url', true);

        try {
            // استخدام Tikwm API المباشر بطلب HTTP مباشر لتفادي الاعتماد على مكتبات خارجية
            const apiRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });

            if (!apiRes.data || apiRes.data.code !== 0 || !apiRes.data.data) {
                throw new Error('فشل جلب المقطع، تأكد من صحة الرابط.');
            }

            const videoData = apiRes.data.data;
            
            // جلب رابط الفيديو (بدون علامة مائية)
            let videoDirectUrl = videoData.play;
            if (videoDirectUrl && !videoDirectUrl.startsWith('http')) {
                videoDirectUrl = `https://www.tikwm.com${videoDirectUrl}`;
            }

            if (!videoDirectUrl) {
                throw new Error('لم يتم العثور على رابط فيديو صالح.');
            }

            // تنزيل ملف الفيديو كـ Buffer
            const videoBufferRes = await axios.get(videoDirectUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': 'https://www.tiktok.com/'
                },
                timeout: 25000
            });

            const videoBuffer = Buffer.from(videoBufferRes.data);

            // التحقق من الحجم لمطابقة حد ديسكورد (25MB)
            const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
            if (videoBuffer.length > 25 * 1024 * 1024) {
                await interaction.editReply({ 
                    content: `⚠️ حجم المقطع كبير جداً (${sizeInMB}MB) ويتجاوز حد ديسكورد (25MB).` 
                });
                return;
            }

            const attachment = new AttachmentBuilder(videoBuffer, { name: 'tiktok-video.mp4' });

            await interaction.editReply({
                content: `🎬 **تم التحميل بنجاح بواسطة ${interaction.user.username}**`,
                files: [attachment]
            });

        } catch (error: any) {
            console.error('❌ تفاصيل خطأ التنزيل:', error);
            const detailedMessage = error?.message || 'حدث خطأ غير معروف أثناء معالجة الطلب.';
            
            await interaction.editReply({
                content: `❌ **فشلت عملية التحميل:**\n\`${detailedMessage}\``
            });
        }
    }
    else if (commandName === 'chat-toggle') {
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

// ==========================================
// 4. خادم HTTP لإبقاء Render في حالة Live
// ==========================================
const PORT = process.env.PORT || 10000;
http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot is online!");
    res.end();
}).listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});

client.login(BOT_TOKEN);
