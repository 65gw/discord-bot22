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
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || ''; // Render يحفظ رابط التطبيق تلقائياً في هذا المتغير

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
// 3. نظام التنزيل بـ 5 خطط متعاقبة
// ==========================================
async function fetchTikTokWith5Plans(targetUrl: string): Promise<Buffer> {
    const defaultUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    // 🔴 الخطة 1: Tikwm API
    try {
        console.log('🔄 جاري تجربة الخطة (1) - Tikwm Proxy...');
        const res1 = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`, {
            headers: { 'User-Agent': defaultUA },
            timeout: 10000
        });

        if (res1.data && res1.data.code === 0 && res1.data.data) {
            const videoData = res1.data.data;
            const playUrl = videoData.hdplay || videoData.play || videoData.wmplay;
            const fullUrl = playUrl.startsWith('http') ? playUrl : `https://www.tikwm.com${playUrl}`;

            const fileRes = await axios.get(fullUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': defaultUA,
                    'Referer': 'https://www.tikwm.com/',
                    'Accept': '*/*'
                },
                timeout: 15000
            });

            if (fileRes.data && fileRes.data.byteLength > 50000) {
                console.log('✅ نجحت الخطة (1)');
                return Buffer.from(fileRes.data);
            }
        }
    } catch (err: any) {
        console.log(`⚠️ فشلت الخطة (1): ${err.message || 'Error'}`);
    }

    // 🔴 الخطة 2: Tiklydown API
    try {
        console.log('🔄 جاري تجربة الخطة (2) - Tiklydown...');
        const res2 = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(targetUrl)}`, {
            headers: { 'User-Agent': defaultUA },
            timeout: 10000
        });

        if (res2.data && res2.data.video && res2.data.video.noWatermark) {
            const videoUrl = res2.data.video.noWatermark;
            const fileRes = await axios.get(videoUrl, {
                responseType: 'arraybuffer',
                headers: { 'User-Agent': defaultUA },
                timeout: 15000
            });

            if (fileRes.data && fileRes.data.byteLength > 50000) {
                console.log('✅ نجحت الخطة (2)');
                return Buffer.from(fileRes.data);
            }
        }
    } catch (err: any) {
        console.log(`⚠️ فشلت الخطة (2): ${err.message || 'Error'}`);
    }

    // 🔴 الخطة 3: Cobalt API
    try {
        console.log('🔄 جاري تجربة الخطة (3) - Cobalt Engine...');
        const res3 = await axios.post('https://api.cobalt.tools/api/json', {
            url: targetUrl,
            videoQuality: '720',
            filenamePattern: 'basic'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': defaultUA
            },
            timeout: 12000
        });

        if (res3.data && res3.data.url) {
            const fileRes = await axios.get(res3.data.url, {
                responseType: 'arraybuffer',
                headers: { 'User-Agent': defaultUA },
                timeout: 15000
            });

            if (fileRes.data && fileRes.data.byteLength > 50000) {
                console.log('✅ نجحت الخطة (3)');
                return Buffer.from(fileRes.data);
            }
        }
    } catch (err: any) {
        console.log(`⚠️ فشلت الخطة (3): ${err.message || 'Error'}`);
    }

    // 🔴 الخطة 4: SSSTik Scraping
    try {
        console.log('🔄 جاري تجربة الخطة (4) - SSSTik Direct...');
        const postData = new URLSearchParams();
        postData.append('id', targetUrl);
        postData.append('locale', 'en');
        postData.append('tt', 'RFBzS3A1');

        const res4 = await axios.post('https://ssstik.io/abc?url=dl', postData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': defaultUA,
                'Hx-Request': 'true',
                'Hx-Target': 'target'
            },
            timeout: 10000
        });

        const html = res4.data || '';
        const match = html.match(/href="(https:\/\/[^"]+)"[^>]*class="[^"]*download_link/);
        
        if (match && match[1]) {
            const directLink = match[1];
            const fileRes = await axios.get(directLink, {
                responseType: 'arraybuffer',
                headers: { 
                    'User-Agent': defaultUA,
                    'Referer': 'https://ssstik.io/'
                },
                timeout: 15000
            });

            if (fileRes.data && fileRes.data.byteLength > 50000) {
                console.log('✅ نجحت الخطة (4)');
                return Buffer.from(fileRes.data);
            }
        }
    } catch (err: any) {
        console.log(`⚠️ فشلت الخطة (4): ${err.message || 'Error'}`);
    }

    // 🔴 الخطة 5: Loli TikTok API
    try {
        console.log('🔄 جاري تجربة الخطة (5) - Loli Fallback...');
        const res5 = await axios.get(`https://api.lolihuman.xyz/api/tiktok?apikey=free&url=${encodeURIComponent(targetUrl)}`, {
            headers: { 'User-Agent': defaultUA },
            timeout: 10000
        });

        if (res5.data && res5.data.result && res5.data.result.link) {
            const fileRes = await axios.get(res5.data.result.link, {
                responseType: 'arraybuffer',
                headers: { 'User-Agent': defaultUA },
                timeout: 15000
            });

            if (fileRes.data && fileRes.data.byteLength > 50000) {
                console.log('✅ نجحت الخطة (5)');
                return Buffer.from(fileRes.data);
            }
        }
    } catch (err: any) {
        console.log(`⚠️ فشلت الخطة (5): ${err.message || 'Error'}`);
    }

    throw new Error('فشلت جميع الخطط الخمسة في تنزيل المقطع. قد يكون المقطع خاصاً أو محظوراً.');
}

// ==========================================
// 4. الأحداث والتفاعل مع الأوامر
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
            const videoBuffer = await fetchTikTokWith5Plans(url);

            const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
            if (videoBuffer.length > 25 * 1024 * 1024) {
                await interaction.editReply({ 
                    content: `⚠️ حجم المقطع كبير جداً (${sizeInMB}MB) ويتجاوز حد رفع المرفقات في ديسكورد (25MB).` 
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
// 5. خادم HTTP + نظام الـ Keep-Alive ومنع الخمول
// ==========================================
const PORT = process.env.PORT || 10000;
const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot is online and active!");
    res.end();
});

server.listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);

    // إرسال طلب ذاتي كل 10 دقائق منعاً لخمول السيرفر (Self-Ping Every 10 Minutes)
    setInterval(async () => {
        try {
            const urlToPing = RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
            await axios.get(urlToPing);
            console.log('⏰ [Keep-Alive] تم إرسال نبضة تنشيط للسيرفر لمنع الخمول.');
        } catch (err) {
            console.log('⚠️ [Keep-Alive Ping Error]:', err instanceof Error ? err.message : err);
        }
    }, 10 * 60 * 1000); // 10 دقائق
});

// ==========================================
// 6. الإمساك بإشارات إعادة التشغيل (SIGTERM)
// ==========================================
process.on('SIGTERM', async () => {
    console.log('⚠️ تم استقبال إشارة إعادة التشغيل من Render...');
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('🔄 تنبيه: إعادة تشغيل السيرفر')
        .setDescription('جاري إيقاف البوت مؤقتاً لإعادة التشغيل أو تحديث الكود...')
        .setTimestamp();
    
    await sendLogEmbed(embed);
    process.exit(0);
});

client.login(BOT_TOKEN);
