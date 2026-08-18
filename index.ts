// @ts-nocheck
import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    TextChannel,
    AttachmentBuilder,
    EmbedBuilder
} from 'discord.js';
import { 
    joinVoiceChannel, 
    VoiceConnectionStatus, 
    entersState, 
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource
} from '@discordjs/voice';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import fs from 'fs';
import path from 'path';
import ytDlp from 'yt-dlp-exec';

dotenv.config();

// ==========================================
// 1. الثوابت ومتغيرات الرئيسية
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

const TARGET_TEXT_CHANNEL_ID = '1459632620416532554'; 
const TARGET_VOICE_CHANNEL_ID = '1433499015462387895'; 
const LOG_CHANNEL_ID = '1539168688643645492';

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
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageTyping,
    ],
});

// ==========================================
// 2. توجيه الهوية الشامل للبوت التقني والذكائي
// ==========================================
const BOT_PROMPT = `أنت بوت آلي متفاعل في سيرفر ديسكورد، ذكي، حاد الذكاء، ومباشر في التعامل. أنت تفهم سياق المحادثة بامتياز.

[قواعد الشخصية وسلوك الرد الصارم]:

1. سياق المحادثة والفهم الذكي:
- أنت تفهم مجريات المحادثة. إذا طلب المستخدم طلباً مقتضباً مثل "طوره"، "عدله"، أو "اشرحه"، فاعلم أنه يقصد آخر موضوع أو كود تم النقاش حوله، وقم بتنفيذ الطلب على الفور استناداً للسياق السابق دون طلب توضيحات إضافية.

2. البرمجة وتنسيق الأكواد (قاعدة صارمة جداً):
- إذا كان الرد يحتوي على برمجة، أكواد، أو أوامر (Commands): اشرح بالتفصيل الشامل، وأعطه أفضل الممارسات.
- **تنسيق الكود (Markdown):** يمنع منعاً باتاً إرسال أي كود برمجي كنص عادي. **يجب** وضع جميع الأكواد داخل مربعات الأكواد المنسقة (Code Blocks) باستخدام ثلاث علامات (\`\`\`) مع تحديد لغة البرمجة (مثال: \`\`\`python أو \`\`\`typescript) لضمان ظهورها بخلفية مخصصة في ديسكورد وعدم تداخل السطور.

3. التعامل مع الصور، الستيكرات، GIF، والافتارات:
- يمنع منعاً باتاً شرح الصورة أو وصف مكوناتها بأسلوب تقريري (ممنوع تقول "الصورة عبارة عن..." أو "يظهر بالصورة...").
- افهم السياق والذبة أو المعنى الخفي خلف الستيكر/الميم/الافتار وتفاعل معه مباشرة:
   - إذا كان الميم/الستيكر مضحك أو ذبة: رد بذبة أو تعليق ساخر متناسق معها.
   - إذا كان يعبّر عن ردة فعل: تفاعل مع ردة الفعل بأسلوب واقعي وعفوي كعضو في الشات.

4. السوالف والردود العامة:
- إذا كانت الرسالة مجرد سوالف، سلام، أو كلام عام: يجب أن يكون الرد مقتضباً وقصيراً جداً (من سطر إلى سطرين كحد أقصى) وبدون إطالة أو رسميات.`;

// ==========================================
// دالة تقسيم النصوص الطويلة لتفادي حد الـ 2000 حرف
// ==========================================
function splitMessage(text: string, maxLength = 1900): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let cur = text;
    while (cur.length > 0) {
        if (cur.length <= maxLength) {
            chunks.push(cur);
            break;
        }
        let ins = cur.lastIndexOf('\n', maxLength);
        if (ins === -1) ins = maxLength;
        chunks.push(cur.slice(0, ins));
        cur = cur.slice(ins).trimStart();
    }
    return chunks;
}

// ==========================================
// 3. سيرفر الويب لخدمة Render
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write('Tech Assistant Bot is Online...');
    res.end();
}).listen(PORT, () => {
    console.log(` [Server] Listening on port ${PORT}`);
});

// ==========================================
// 4. نظام Keep-Alive
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
// دالة إرسال اللوق المنظم (Embed)
// ==========================================
async function sendLogEmbed(embed: EmbedBuilder) {
    try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (logChannel && logChannel.isTextBased()) {
            await (logChannel as TextChannel).send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('فشل إرسال اللوق إلى القناة:', err);
    }
}

// ==========================================
// 5. التواصل مع Dify ومعالجة الصور والميديا
// ==========================================
async function sendQueryToDify(
    prompt: string, 
    userId: string, 
    imageUrl?: string, 
    onHighDemand?: () => Promise<void> | void
): Promise<string> {
    const totalKeys = difyApiKeys.length;
    const maxCycles = 3;
    let notifiedHighDemand = false;

    const isValidImageUrl = imageUrl && (
        imageUrl.endsWith('.png') || 
        imageUrl.endsWith('.jpg') || 
        imageUrl.endsWith('.jpeg') || 
        imageUrl.endsWith('.webp') ||
        imageUrl.endsWith('.gif')
    );

    const files = isValidImageUrl ? [{ type: 'image', transfer_method: 'remote_url', url: imageUrl }] : [];
    const finalPrompt = `${BOT_PROMPT}\n\n${prompt}`;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
        let attempts = 0;
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
                const errorDetails = JSON.stringify(error.response?.data || error.message || '');
                
                if (errorDetails.includes('503') || errorDetails.includes('UNAVAILABLE') || errorDetails.includes('high demand') || error.response?.status === 503) {
                    if (onHighDemand && !notifiedHighDemand) {
                        try { await onHighDemand(); } catch (e) {}
                        notifiedHighDemand = true;
                    }
                    await new Promise(res => setTimeout(res, 3000));
                }
            }
            attempts++;
        }
        await new Promise(res => setTimeout(res, 4000));
    }

    return 'يبدو أن الضغط مرتفع جداً على السيرفرات حالياً، حاول مجدداً بعد لحظات.';
}

// ==========================================
// 6. نظام تشخيص الأخطاء المتقدم وإرسالها للوق
// ==========================================
async function handleSystemCrashAndReport(error: any, errorType: string) {
    console.error(` [Crash Detected - ${errorType}]:`, error);

    try {
        const errorMessage = error?.stack || error?.message || String(error);
        
        let sourceCode = '';
        try {
            sourceCode = fs.readFileSync(__filename, 'utf8');
        } catch (e) {
            sourceCode = 'تعذر قراءة ملف الكود المصدري.';
        }

        const diagnosticPrompt = `حدث خطأ كراش في البوت أثناء التشغيل:
[الخطأ / Stack Trace]:
${errorMessage.slice(0, 1500)}

[أجزاء من الكود المصدري]:
${sourceCode.slice(0, 3000)}

المطلوب منك:
1. حدد في أي سطر/دالة حدثت المشكلة بالضبط.
2. اشرح المشكلة بإيجاز.
3. قدّم الكود المصحح للسطر المتضرر مباشرة داخل مربع كود markdown.`;

        const aiAnalysis = await sendQueryToDify(diagnosticPrompt, 'system_crash_reporter');

        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle(`🚨 رصد خطأ في النظام (${errorType})`)
            .addFields(
                { name: '📄 تفاصيل الخطأ المباشر', value: `\`\`\`javascript\n${errorMessage.slice(0, 1000)}\n\`\`\`` },
                { name: '🛠️ تحليل AI وموقع المشكلة مع الحل', value: aiAnalysis.slice(0, 1024) }
            )
            .setTimestamp();

        await sendLogEmbed(embed);
    } catch (logErr) {
        console.error('فشل إرسال تقرير الكراش لروم اللوق:', logErr);
    }
}

process.on('unhandledRejection', (reason) => {
    handleSystemCrashAndReport(reason, 'Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
    handleSystemCrashAndReport(err, 'Uncaught Exception');
});

// ==========================================
// 7. نظام الاتصال الصوتي والنطق (المعزز للبقاء دائمًا)
// ==========================================
let isConnectingVoice = false;

async function ensureVoiceConnection() {
    if (isConnectingVoice) return;
    isConnectingVoice = true;

    try {
        const voiceChannel = await client.channels.fetch(TARGET_VOICE_CHANNEL_ID).catch(() => null);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) {
            isConnectingVoice = false;
            return null;
        }

        let connection = getVoiceConnection(voiceChannel.guild.id);

        if (connection) {
            if (connection.state.status === VoiceConnectionStatus.Ready && connection.joinConfig.channelId === TARGET_VOICE_CHANNEL_ID) {
                isConnectingVoice = false;
                return connection;
            }
            try { connection.destroy(); } catch (e) {}
        }

        connection = joinVoiceChannel({
            channelId: TARGET_VOICE_CHANNEL_ID,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        connection.setMaxListeners(30);
        connection.subscribe(audioPlayer);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 3_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 3_000),
                ]);
            } catch (error) {
                try { connection.destroy(); } catch (e) {}
                isConnectingVoice = false;
                setTimeout(() => ensureVoiceConnection(), 1000);
            }
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            isConnectingVoice = false;
            setTimeout(() => ensureVoiceConnection(), 1000);
        });

        isConnectingVoice = false;
        return connection;
    } catch (error) {
        console.error(' Error in ensureVoiceConnection:', error);
        isConnectingVoice = false;
    }
}

async function playTextToSpeech(text: string) {
    try {
        await ensureVoiceConnection();
        const cleanText = text.replace(/[*_~`#]/g, '').slice(0, 200);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${encodeURIComponent(cleanText)}`;
        const resource = createAudioResource(ttsUrl);
        audioPlayer.play(resource);
    } catch (err) {
        console.error('TTS Error:', err);
    }
}

// ==========================================
// 8. وظيفة التنزيل عبر أوامر Slash Command
// ==========================================
async function handleMediaDownloadSlash(interaction: any, url: string) {
    await interaction.deferReply();

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
            maxFilesize: '25M',
        });

        const files = fs.readdirSync(downloadsDir);
        const foundFile = files.find(f => f.startsWith(uniquePrefix));

        if (!foundFile) {
            throw new Error('لم يتم العثور على الملف بعد انتهاء التنزيل.');
        }

        downloadedFilePath = path.join(downloadsDir, foundFile);
        const stats = fs.statSync(downloadedFilePath);

        if (stats.size > 25 * 1024 * 1024) {
            await interaction.editReply('⚠️ **حجم الملف يتجاوز 25 ميجابايت.**');
            return;
        }

        const attachment = new AttachmentBuilder(downloadedFilePath);

        await interaction.editReply({
            content: `🎬 **تم التحميل بنجاح.**`,
            files: [attachment]
        });

    } catch (err: any) {
        console.error('Download System Error:', err.message || err);
        await interaction.editReply(`❌ **تعذّر تحميل الميديا.** قد يكون الرابط غير مدعوم، الحساب خاص، أو الحجم يتجاوز 25MB.`);
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
// 9. تسجيل أوامر Slash وتجهيز البوت
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('chat-toggle').setDescription('تفعيل أو تعطيل ردود الشات التلقائية'),
    new SlashCommandBuilder().setName('topics-toggle').setDescription('تفعيل أو تعطيل المواضيع التلقائية (كل 12 ساعة)'),
    new SlashCommandBuilder().setName('voice-toggle').setDescription('تفعيل أو تعطيل تحويل الردود إلى صوت في الروم الصوتي'),
    new SlashCommandBuilder().setName('speak').setDescription('جعل البوت يتحدث بنص معين في الروم الصوتي')
        .addStringOption(opt => opt.setName('text').setDescription('النص المراد نطقة').setRequired(true)),
    new SlashCommandBuilder().setName('askroom').setDescription('طرح سؤال على البوت والإجابة عليه صوتياً في الروم الصوتي')
        .addStringOption(opt => opt.setName('question').setDescription('السؤال المراد إجابته').setRequired(true)),
    new SlashCommandBuilder().setName('status').setDescription('عرض حالة النظام والبوت الحالية'),
    new SlashCommandBuilder().setName('download').setDescription('تحميل مقطع فيديو أو صورة من أي رابط بأعلى جودة')
        .addStringOption(opt => opt.setName('url').setDescription('رابط الميديا (تيك توك، انستا، يوتيوب...)').setRequired(true))
];

client.once('ready', async (readyClient) => {
    console.log(` Bot is Ready as ${readyClient.user.tag}!`);

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
    setInterval(() => ensureVoiceConnection(), 5000);
    startPeriodicTask(readyClient);
});

// ==========================================
// 10. معالج تفاعلات الأوامر (Interaction Handler)
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'download') {
        const targetUrl = interaction.options.getString('url', true);
        await handleMediaDownloadSlash(interaction, targetUrl);
    }
    else if (commandName === 'askroom') {
        const question = interaction.options.getString('question', true);
        await interaction.deferReply();

        const answer = await sendQueryToDify(
            question, 
            interaction.user.id, 
            undefined, 
            async () => {
                await interaction.editReply('⏳ **انتظر، يوجد ضغط على السيرفرات حالياً وجاري معالجة الإجابة...**');
            }
        );

        const chunks = splitMessage(`💬 **سؤال من ${interaction.user}:** ${question}\n\n🗣️ **الرد:**\n${answer}`);
        await interaction.editReply({ content: chunks[0] });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i] });
        }

        await playTextToSpeech(answer);
    }
    else if (commandName === 'chat-toggle') {
        isChatRespondingEnabled = !isChatRespondingEnabled;
        await interaction.reply({ 
            content: `تم ${isChatRespondingEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} ردود الشات التلقائية.`, 
            ephemeral: true 
        });
    } 
    else if (commandName === 'topics-toggle') {
        isAutoTopicsEnabled = !isAutoTopicsEnabled;
        await interaction.reply({ 
            content: `تم ${isAutoTopicsEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} مواضيع الـ 12 ساعة التلقائية.`, 
            ephemeral: true 
        });
    }
    else if (commandName === 'voice-toggle') {
        isVoiceResponseEnabled = !isVoiceResponseEnabled;
        await interaction.reply({ 
            content: `تم ${isVoiceResponseEnabled ? '🟢 تفعيل' : '🔴 تعطيل'} تحويل ردود الذكاء الاصطناعي لصوت في الروم الصوتي.`, 
            ephemeral: true 
        });
    }
    else if (commandName === 'speak') {
        const textToSpeak = interaction.options.getString('text', true);
        await interaction.deferReply({ ephemeral: true });
        await playTextToSpeech(textToSpeak);
        await interaction.editReply({ content: `🗣️ جاري نطق النص في الروم الصوتي: "${textToSpeak}"` });
    }
    else if (commandName === 'status') {
        const statusMsg = `**حالة نظام البوت المساعد:**
• ردود الشات: ${isChatRespondingEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• مواضيع الـ 12 ساعة: ${isAutoTopicsEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• القراءة الصوتية (TTS): ${isVoiceResponseEnabled ? '🟢 مفعلة' : '🔴 معطلة'}
• عدد مفاتيح Dify النشطة: ${difyApiKeys.length}`;
        await interaction.reply({ content: statusMsg, ephemeral: true });
    }
});

// ==========================================
// 11. أنظمة اللوق وإعادة إرجاع البوت التلقائية
// ==========================================

const typingCooldowns = new Map<string, number>();

client.on('typingStart', async (typing) => {
    if (typing.user && !typing.user.bot) {
        if (typing.channel.id === LOG_CHANNEL_ID) return;

        const userId = typing.user.id;
        const now = Date.now();
        const TWO_HOURS_IN_MS = 2 * 60 * 60 * 1000;

        const lastLogTime = typingCooldowns.get(userId);
        if (lastLogTime && (now - lastLogTime < TWO_HOURS_IN_MS)) {
            return;
        }

        typingCooldowns.set(userId, now);

        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setAuthor({ name: `بدأ الكتابة - ${typing.user.tag}`, iconURL: typing.user.displayAvatarURL() })
            .addFields(
                { name: 'العضو', value: `${typing.user}`, inline: true },
                { name: 'القناة', value: `${typing.channel}`, inline: true },
                { name: 'الأيدي', value: `\`${typing.user.id}\``, inline: true }
            )
            .setTimestamp();

        sendLogEmbed(embed);
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    // إرجاع البوت القسري للروم المحدد إذا تم نقله أو طرده
    if (oldState.member?.id === client.user?.id || newState.member?.id === client.user?.id) {
        if (newState.channelId !== TARGET_VOICE_CHANNEL_ID) {
            setTimeout(() => ensureVoiceConnection(), 1000);
        }
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

client.on('messageDelete', async (message) => {
    if (message.author?.bot || message.channelId === LOG_CHANNEL_ID) return;

    const content = message.content || '[محتوى ميديا أو غير نصي]';

    const embed = new EmbedBuilder()
        .setColor('#ed4245')
        .setAuthor({ name: `حذف رسالة - ${message.author?.tag || 'غير معروف'}`, iconURL: message.author?.displayAvatarURL() })
        .addFields(
            { name: 'صاحب الرسالة', value: `${message.author || 'غير معروف'}`, inline: true },
            { name: 'القناة', value: `<#${message.channelId}>`, inline: true },
            { name: 'الأيدي', value: `\`${message.author?.id || 'غير معروف'}\``, inline: true },
            { name: 'المحتوى', value: content.length > 1024 ? content.slice(0, 1021) + '...' : content, inline: false }
        )
        .setTimestamp();

    sendLogEmbed(embed);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.author?.bot || newMessage.channelId === LOG_CHANNEL_ID) return;
    if (oldMessage.content === newMessage.content) return;

    const oldContent = oldMessage.content || '[لا يوجد]';
    const newContent = newMessage.content || '[لا يوجد]';

    const embed = new EmbedBuilder()
        .setColor('#fee75c')
        .setAuthor({ name: `تعديل رسالة - ${newMessage.author?.tag}`, iconURL: newMessage.author?.displayAvatarURL() })
        .addFields(
            { name: 'العضو', value: `${newMessage.author}`, inline: true },
            { name: 'القناة', value: `<#${newMessage.channelId}>`, inline: true },
            { name: 'الأيدي', value: `\`${newMessage.author?.id}\``, inline: true },
            { name: 'قبل التعديل', value: oldContent.length > 1024 ? oldContent.slice(0, 1021) + '...' : oldContent, inline: false },
            { name: 'بعد التعديل', value: newContent.length > 1024 ? newContent.slice(0, 1021) + '...' : newContent, inline: false }
        )
        .setTimestamp();

    sendLogEmbed(embed);
});

client.on('guildMemberAdd', (member) => {
    if (member.user.bot) return;

    const embed = new EmbedBuilder()
        .setColor('#57f287')
        .setAuthor({ name: `انضمام عضو - ${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
        .addFields(
            { name: 'العضو', value: `${member.user}`, inline: true },
            { name: 'الأيدي', value: `\`${member.id}\``, inline: true }
        )
        .setTimestamp();

    sendLogEmbed(embed);
});

client.on('guildMemberRemove', (member) => {
    if (member.user.bot) return;

    const embed = new EmbedBuilder()
        .setColor('#ed4245')
        .setAuthor({ name: `مغادرة عضو - ${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
        .addFields(
            { name: 'العضو', value: `${member.user}`, inline: true },
            { name: 'الأيدي', value: `\`${member.id}\``, inline: true }
        )
        .setTimestamp();

    sendLogEmbed(embed);
});

// ==========================================
// 12. المهام التلقائية والشات الرئيسي
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_TEXT_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `اطرح سؤالاً تقنياً أو برمجياً باختصار شديد في سطر واحد لتحديث الشات.`;
            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            if (!answer.startsWith('يبدو أن الاتصال') && !answer.startsWith('يبدو أن الضغط')) {
                const chunks = splitMessage(answer);
                for (const chunk of chunks) {
                    await (channel as TextChannel).send(chunk);
                }
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

// معالجة قراءة الميديا (افتار، استيكر، صور، GIF)
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

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
                    chatHistoryContext = `[سياق الرسائل الأخيرة]:\n${last5}\n---`;
                }
            } catch (err) {
                console.error('فشل جلب الرسائل:', err);
            }

            let mediaUrl: string | undefined = undefined;
            let mediaTypeNotice = '';

            if (message.mentions.users.size > 0) {
                const mentionedUser = message.mentions.users.find(u => u.id !== client.user?.id);
                if (mentionedUser) {
                    mediaUrl = mentionedUser.displayAvatarURL({ extension: 'png', size: 512 });
                    mediaTypeNotice = `[المرفق: صورة افتار العضو ${mentionedUser.username}]`;
                }
            }

            if (!mediaUrl && message.stickers.size > 0) {
                const sticker = message.stickers.first();
                if (sticker) {
                    mediaUrl = sticker.url;
                    mediaTypeNotice = `[المرفق: ستيكر باسم "${sticker.name}"]`;
                }
            }

            if (!mediaUrl && message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment && attachment.contentType?.startsWith('image/')) {
                    mediaUrl = attachment.url;
                    mediaTypeNotice = attachment.contentType.includes('gif') ? `[المرفق: صورة متحركة GIF]` : `[المرفق: صورة مرفقة]`;
                }
            }

            if (!mediaUrl) {
                const mediaLinkRegex = /(https?:\/\/(?:www\.)?(?:tenor\.com|giphy\.com|media\.giphy\.com)\/\S+)/i;
                const match = message.content.match(mediaLinkRegex);
                if (match) {
                    mediaTypeNotice = `[المرفق: رابط ميديا GIF / Meme: ${match[0]}]`;
                }
            }

            let cleanText = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanText = cleanText.replace(mentionRegex, '').trim();
            }

            const promptToSend = `${chatHistoryContext}\nصاحب الرسالة: ${message.author.username}\nالمحتوى النصي: "${cleanText}"\n${mediaTypeNotice}`;

            let highDemandMessage: any = null;

            const answer = await sendQueryToDify(
                promptToSend, 
                message.author.id, 
                mediaUrl, 
                async () => {
                    highDemandMessage = await message.reply('⏳ **انتظر، يوجد ضغط على السيرفرات حالياً وجاري المعالجة...**');
                }
            );

            const chunks = splitMessage(answer);

            if (highDemandMessage) {
                await highDemandMessage.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]);
                }
            } else {
                await message.reply(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]);
                }
            }

            if (isVoiceResponseEnabled) {
                playTextToSpeech(answer);
            }
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
