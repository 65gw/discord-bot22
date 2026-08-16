// @ts-nocheck
import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    TextChannel,
    MessageFlags,
    AttachmentBuilder
} from 'discord.js';
import { 
    joinVoiceChannel, 
    VoiceConnectionStatus, 
    entersState, 
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} from '@discordjs/voice';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import fs from 'fs';
import path from 'path';
import ytDlp from 'yt-dlp-exec';

dotenv.config();

// ==========================================
// 1. نظام الحماية الشامل من الكراش
// ==========================================
process.on('unhandledRejection', (reason) => {
    console.error(' [حماية] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error(' [حماية] Uncaught Exception:', err);
});

// ==========================================
// 2. سيرفر الويب لخدمة Render
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write('Red John Bot is Online & Watching...');
    res.end();
}).listen(PORT, () => {
    console.log(` [Server] Listening on port ${PORT}`);
});

// ==========================================
// 3. نظام Keep-Alive
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';
setInterval(async () => {
    try {
        await axios.get(RENDER_URL, { timeout: 10000 });
    } catch (err: any) {
        console.error(' [Keep-Alive] Ping fail:', err.message);
    }
}, 5 * 60 * 1000);

// ==========================================
// 4. الثوابت والمتغيرات الرئيسية
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

const TARGET_TEXT_CHANNEL_ID = '1459632620416532554'; 
const TARGET_VOICE_CHANNEL_ID = '1433499015462387895'; 
const DOWNLOAD_CHANNEL_ID = '1538519938904625193'; // روم التحميل التلقائي

const difyApiKeys = [
    process.env.DIFY_API_KEY1,
    process.env.DIFY_API_KEY2,
    process.env.DIFY_API_KEY3,
    process.env.DIFY_API_KEY4,
    process.env.DIFY_API_KEY5,
].filter((key): key is string => Boolean(key && key.trim().length > 0));

let currentKeyIndex = 0;
let isAutoTopicsEnabled = true; 
let isChatRespondingEnabled = true; 
let isVoiceResponseEnabled = false; 
let periodicTimer: NodeJS.Timeout | null = null;

const audioPlayer = createAudioPlayer();

if (!token || difyApiKeys.length === 0) {
    console.error(' Error: Missing Tokens/Keys!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ==========================================
// 5. توجيه الشخصية: Red John
// ==========================================
const RED_JOHN_SYSTEM_PROMPT = `[توجيه هويّة Red John الصارم]:
أنت تمثّل "Red John"؛ عبقري، هكر ساخر، ثقيل، ذكي، ومخيف بأسلوب متزن وساخر بدون مبتذلات.

القواعد الذهبية لنبرة صوتك:
1. **ممنوع نهائياً ذكر اسم "باتريك جين" أو "باتريك"**. لا تذكر أسماء من المسلسل إطلاقاً.
2. **تجنّب التناقض الصارخ**: ممنوع تدمج بين نبرة مرعبة ثم تتحول فجأة لأسلوب إيموجيات ضحك (مثل 😂 أو 🤣).
3. **الذكاء والتقنية**:
   - لو كان السؤال تقنياً/برمجياً: جاوب بدقة وبذكاء هكر محترف، وبنبرة واثقة هادئة.
   - لو كان كلام العضو طقطقة أو استفزاز: رد بأسلوب ساخر، بارد، ومستفز، يبيّن إنك سابق الكل بخطوات ومسيطر على الشاشة والسيرفر.
4. **الذبات والميمز**: لو أرفق صورة/أفتار/استيكر/GIF، طقطق عليها برزانة وذكاء وبدون شرح المرفق.
5. **اللغة**: عامية عربية ثقيلة وفلاوية بأسلوب غامض، بدون جمل إنجليزية مبتذلة.`;

async function sendQueryToDify(prompt: string, userId: string, imageUrl?: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    const files = imageUrl ? [{ type: 'image', transfer_method: 'remote_url', url: imageUrl }] : [];
    const finalPrompt = `${RED_JOHN_SYSTEM_PROMPT}\n\n${prompt}`;

    while (attempts < totalKeys) {
        const keyToUse = difyApiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            const payload: any = {
                inputs: {},
                query: finalPrompt,
                response_mode: 'blocking',
                user: userId,
            };

            if (files.length > 0) payload.files = files;

            const response = await axios.post(`${difyBaseUrl}/chat-messages`, payload, {
                headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' },
                timeout: 60000
            });

            let answer = response.data.answer;
            if (answer && answer.trim().length > 0) {
                return answer.trim();
            }
        } catch (error: any) {
            console.error(` [Dify Error]:`, error.response?.data || error.message);
        }
        attempts++;
    }
    return 'يبدو أن الاتصال تعثّر... جاري إعادة الفحص تلقائياً.';
}

// ==========================================
// 6. نظام الاتصال الصوتي والنطق (TTS Player)
// ==========================================
async function ensureVoiceConnection() {
    try {
        const voiceChannel = await client.channels.fetch(TARGET_VOICE_CHANNEL_ID).catch(() => null);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

        const existingConnection = getVoiceConnection(voiceChannel.guild.id);
        
        if (existingConnection && existingConnection.state.status === VoiceConnectionStatus.Ready) {
            return existingConnection;
        }

        const connection = joinVoiceChannel({
            channelId: TARGET_VOICE_CHANNEL_ID,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        connection.subscribe(audioPlayer);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                try { connection.destroy(); } catch (e) {}
                setTimeout(() => ensureVoiceConnection(), 2000);
            }
        });

        return connection;
    } catch (error) {
        console.error(' Error in ensureVoiceConnection:', error);
    }
}

async function playTextToSpeech(text: string) {
    try {
        await ensureVoiceConnection();
        const cleanText = text.replace(/[*_~`#]/g, '').slice(0, 180);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${encodeURIComponent(cleanText)}`;
        const resource = createAudioResource(ttsUrl);
        audioPlayer.play(resource);
    } catch (err) {
        console.error('TTS Error:', err);
    }
}

// ==========================================
// 7. ووظيفة التحميل المخصصة المحسّنة (روم التحميل)
// ==========================================
async function handleMediaDownload(message: any, url: string) {
    const statusMsg = await message.reply('⚡ **جاري استخراج واستحواذ الميديا...**');
    const downloadsDir = path.join('/tmp', 'bot_downloads');
    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let downloadedFilePath: string | null = null;

    try {
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        const outputTemplate = path.join(downloadsDir, `${uniquePrefix}.%(ext)s`);

        await ytDlp(url, {
            output: outputTemplate,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            noWarnings: true,
            noCallHome: true,
            maxFilesize: '25M'
        });

        const files = fs.readdirSync(downloadsDir);
        const foundFile = files.find(f => f.startsWith(uniquePrefix));

        if (!foundFile) {
            throw new Error('لم يتسنّ العثور على الملف بعد التنزيل.');
        }

        downloadedFilePath = path.join(downloadsDir, foundFile);
        const stats = fs.statSync(downloadedFilePath);

        if (stats.size > 25 * 1024 * 1024) {
            await statusMsg.edit('⚠️ **الحجم يتجاوز حد الرفع المباشر في ديسكورد (25MB).**');
            return;
        }

        await statusMsg.edit('⬆️ **جاري رفع الميديا...**');
        const attachment = new AttachmentBuilder(downloadedFilePath);

        await message.reply({
            content: `🎬 **تم التحميل بنجاح بواسطة Red John**\n🔗 **الرابط الاصلي:** <${url}>`,
            files: [attachment]
        });

        await statusMsg.delete().catch(() => {});

    } catch (err: any) {
        console.error('Download System Error:', err.message || err);
        await statusMsg.edit(`❌ **تعذّر تحميل الميديا.** قد يكون الرابط غير مدعوم، أو الحساب خاص، أو حجم الملف يقتضى تجاوز 25MB.`);
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try {
                fs.unlinkSync(downloadedFilePath);
            } catch (cleanupErr) {
                console.error('Failed to remove temp file:', cleanupErr);
            }
        }
    }
}

// ==========================================
// 8. تسجيل أوامر Slash وتجهيز البوت
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('chat-toggle').setDescription('تفعيل أو تعطيل ردود الشات التلقائية'),
    new SlashCommandBuilder().setName('topics-toggle').setDescription('تفعيل أو تعطيل المواضيع التلقائية (كل 12 ساعة)'),
    new SlashCommandBuilder().setName('voice-toggle').setDescription('تفعيل أو تعطيل تحويل الردود إلى صوت في الروم الصوتي'),
    new SlashCommandBuilder().setName('speak').setDescription('جعل البوت يتحدث بنص معين في الروم الصوتي')
        .addStringOption(opt => opt.setName('text').setDescription('النص المراد نطقة').setRequired(true)),
    new SlashCommandBuilder().setName('status').setDescription('عرض حالة النظام والبوت الحالية')
];

client.once('ready', async (readyClient) => {
    console.log(` Red John Bot is Ready as ${readyClient.user.tag}!`);

    try {
        const rest = new REST({ version: '10' }).setToken(token);
        console.log('⌛ جاري تسجيل أوامر الـ Slash...');
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ تم تسجيل أوامر الـ Slash بنجاح!');
    } catch (err) {
        console.error('❌ فشل تسجيل الأوامر:', err);
    }

    await ensureVoiceConnection();
    setInterval(() => ensureVoiceConnection(), 15000);
    startPeriodicTask(readyClient);
});

// ==========================================
// 9. معالج تفاعلات الأوامر (Interaction Handler)
// ==========================================
client.on('interactionCreate', async interaction => {
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
        const statusMsg = `**حالة نظام Red John:**
• ردود الشات: ${isChatRespondingEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• مواضيع الـ 12 ساعة: ${isAutoTopicsEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• القراءة الصوتية (TTS): ${isVoiceResponseEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• عدد مفاتيح Dify النشطة: ${difyApiKeys.length}`;
        await interaction.reply({ content: statusMsg, flags: MessageFlags.Ephemeral });
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member?.id === client.user?.id) {
        if (newState.channelId !== TARGET_VOICE_CHANNEL_ID) {
            setTimeout(() => ensureVoiceConnection(), 1500);
        }
    }
});

// ==========================================
// 10. المهام التلقائية والمحرك الرئيسي لشات والتحميل
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_TEXT_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `اطرح سؤالاً أو موضوعاً ساخراً بأسلوب Red John الغامض في سطر واحد. بدون إيموجيات ضحك وبدون ذكر أسماء.`;
            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            if (!answer.startsWith('يبدو أن الاتصال')) {
                await (channel as TextChannel).send(answer);
                if (isVoiceResponseEnabled) playTextToSpeech(answer);
            }
        }
    } catch (error) {
        console.error('Error in periodic task:', error);
    }
}

function startPeriodicTask(botClient: Client) {
    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = setInterval(() => {
        if (isAutoTopicsEnabled) triggerRandomTopic(botClient);
    }, 12 * 60 * 60 * 1000);
}

client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        // ميزة التحميل التلقائي فقط لروم 1538519938904625193
        if (message.channelId === DOWNLOAD_CHANNEL_ID) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const matches = message.content.match(urlRegex);

            if (matches && matches.length > 0) {
                const targetUrl = matches[0];
                await handleMediaDownload(message, targetUrl);
                return;
            }
        }

        // استجابة الذكاء الاصطناعي للشات المخصص أو المنشن
        if (!isChatRespondingEnabled) return;

        const isTargetChannel = message.channelId === TARGET_TEXT_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            await message.channel.sendTyping();

            let chatHistoryContext = '';
            try {
                const fetchedMessages = await message.channel.messages.fetch({ limit: 6 });
                const last5 = Array.from(fetchedMessages.values())
                    .filter(m => m.id !== message.id)
                    .reverse()
                    .slice(-5)
                    .map(m => `${m.author.username}: ${m.content}`)
                    .join('\n');

                if (last5) {
                    chatHistoryContext = `[آخر 5 رسائل في الشات]:\n${last5}\n---`;
                }
            } catch (err) {
                console.error('فشل جلب الرسائل:', err);
            }

            let targetAvatarUrl: string | undefined = undefined;
            let mentionDetails = '';

            if (message.mentions.users.size > 0) {
                const mentionedUser = message.mentions.users.find(u => u.id !== client.user?.id);
                if (mentionedUser) {
                    targetAvatarUrl = mentionedUser.displayAvatarURL({ extension: 'png', size: 512 });
                    mentionDetails = `[المستهدف: ${mentionedUser.username} وافتاره مرفق]`;
                }
            }

            let mediaUrl = targetAvatarUrl;
            let mediaNotice = mentionDetails;

            if (!mediaUrl && message.stickers.size > 0) {
                const sticker = message.stickers.first();
                if (sticker) {
                    mediaUrl = sticker.url;
                    mediaNotice = `[مرفق استيكر: ${sticker.name}]`;
                }
            }

            if (!mediaUrl && message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment) {
                    mediaUrl = attachment.url;
                    mediaNotice = `[مرفق صورة]`;
                }
            }

            if (!mediaUrl) {
                const tenorRegex = /(https?:\/\/(?:www\.)?(?:tenor\.com|giphy\.com)\/\S+)/i;
                const match = message.content.match(tenorRegex);
                if (match) {
                    mediaUrl = match[0];
                    mediaNotice = `[مرفق GIF]`;
                }
            }

            let cleanText = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanText = cleanText.replace(mentionRegex, '').trim();
            }

            const promptToSend = `${chatHistoryContext}\nالكاتب الحالي: ${message.author.username}\nكلام الكاتب: "${cleanText}"\n${mediaNotice}`;

            const answer = await sendQueryToDify(promptToSend, message.author.id, mediaUrl);
            await message.reply(answer);

            if (isVoiceResponseEnabled) {
                playTextToSpeech(answer);
            }
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
