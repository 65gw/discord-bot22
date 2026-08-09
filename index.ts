import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// ==========================================
// 1. نظام الحماية الفولاذي من الكراش
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
    res.write('Bot is 100% Alive and Running!');
    res.end();
}).listen(PORT, () => {
    console.log(` [Server] Web server listening on port ${PORT}`);
});

// ==========================================
// 3. نظام الـ Self-Ping لمنع خمول Render
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';

setInterval(async () => {
    try {
        await axios.get(RENDER_URL, { timeout: 10000 });
        console.log(' [Keep-Alive] Self-ping successful!');
    } catch (err: any) {
        console.error(' [Keep-Alive] Self-ping failed:', err.message);
    }
}, 8 * 60 * 1000);

// ==========================================
// 4. قراءة المفاتيح المتغيرة
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

const TARGET_CHANNEL_ID = '1459632620416532554'; 
const VIP_USERNAME = process.env.VIP_USERNAME; 
const VIP_USER_ID = process.env.VIP_USER_ID; 

const difyApiKeys = [
    process.env.DIFY_API_KEY1,
    process.env.DIFY_API_KEYS2,
    process.env.DIFY_API_KEYS3,
    process.env.DIFY_API_KEYS4,
    process.env.DIFY_API_KEYS5,
].filter((key): key is string => Boolean(key && key.trim().length > 0));

let currentKeyIndex = 0;

// متغيرات التحكم بالحالة
let isAutoTopicsEnabled = true; 
let periodicTimer: NodeJS.Timeout | null = null;

if (!token || difyApiKeys.length === 0) {
    console.error(' Error: DISCORD_BOT_TOKEN or DIFY_API_KEYS is missing in Render!');
    process.exit(1);
}

console.log(` [Dify] Loaded ${difyApiKeys.length} separate API key(s) successfully.`);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ==========================================
// 5. تسجيل الأوامر والتشغيل الأولي
// ==========================================
client.once('ready', async (readyClient) => {
    console.log(` Logged in as ${readyClient.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('ask')
            .setDescription('سؤال البوت مباشرة')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('الرسالة أو السؤال')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('avatar')
            .setDescription('فحص وتحليل افتار عضو معين')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('العضو المراد فحص افتاره')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('auto-topics')
            .setDescription('تشغيل أو إيقاف المواضيع التلقائية (كل 12 ساعة)')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('اختر الحالة')
                    .setRequired(true)
                    .addChoices(
                        { name: 'تشغيل (كل 12 ساعة)', value: 'enable' },
                        { name: 'إيقاف نهائي', value: 'disable' }
                    )
            ),
        new SlashCommandBuilder()
            .setName('topic-now')
            .setDescription('إرسال موضوع شاطح فوراً في الروم'),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    startPeriodicTask(readyClient);
});

// ==========================================
// 6. الاتصال بـ Dify
// ==========================================
async function sendQueryToDify(prompt: string, userId: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    while (attempts < totalKeys) {
        const keyToUse = difyApiKeys[currentKeyIndex];
        const keyNumber = currentKeyIndex + 1;

        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            console.log(` [Dify] Trying Key #${keyNumber}...`);
            const response = await axios.post(
                `${difyBaseUrl}/chat-messages`,
                {
                    inputs: {},
                    query: prompt,
                    response_mode: 'blocking',
                    user: userId,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${keyToUse}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 25000
                }
            );

            let answer = response.data.answer;
            if (answer && answer.trim().length > 0) {
                if (answer.length > 2000) {
                    answer = answer.substring(0, 1990) + '...\n*(الرد مقصوص لكبر الحجم)*';
                }
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify] Key #${keyNumber} failed:`, error.response?.data?.message || error.message);
        }

        attempts++;
    }

    return 'خطأ: تعذر الاتصال بنظام المعالجة حالياً.';
}

// ==========================================
// 7. دالة المواضيع التلقائية
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `طرح موضوع للنقاش بشكل آلي ومباشر.
شروط:
- موضوع عشوائي أو غريب.
- أسلوب بوت نظامي ومباشر بدون مقدمات أو تنميق إنساني.`;

            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            
            if (!answer.startsWith('خطأ:')) {
                await channel.send(answer);
            }
        }
    } catch (error) {
        console.error('Error in periodic task:', error);
    }
}

function startPeriodicTask(botClient: Client) {
    if (periodicTimer) clearInterval(periodicTimer);
    const TWELVE_HOURS = 12 * 60 * 60 * 1000; 

    periodicTimer = setInterval(() => {
        if (isAutoTopicsEnabled) {
            triggerRandomTopic(botClient);
        }
    }, TWELVE_HOURS);
}

// ==========================================
// 8. التعامل مع الـ Slash Commands
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();
        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    } 
    else if (commandName === 'avatar') {
        const targetUser = interaction.options.getUser('user', true);
        const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 512 });
        await interaction.deferReply();

        const prompt = `[تحليل صورة افتار]
اسم المستخدم: ${targetUser.username}
رابط الصورة المباشر: ${avatarUrl}
التعليمات: قم بوصف محتوى الصورة المرفقة في الرابط بدقة وبأسلوب بوت تقني ومباشر.`;

        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    }
    else if (commandName === 'auto-topics') {
        const status = interaction.options.getString('status', true);
        isAutoTopicsEnabled = (status === 'enable');
        await interaction.reply(`🤖 حالة الرسائل التلقائية: **${isAutoTopicsEnabled ? 'مُفعّلة' : 'مُعطّلة'}**`);
    }
    else if (commandName === 'topic-now') {
        await interaction.reply({ content: '🤖 جاري تشغيل وحدة الأوامر التلقائية...', ephemeral: true });
        await triggerRandomTopic(client);
    }
});

// ==========================================
// 9. التعامل مع الرسائل، الافتارات، والمرفقات
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const contentLower = message.content.trim().toLowerCase();
        const isVIP = (VIP_USERNAME && message.author.username.toLowerCase() === VIP_USERNAME.toLowerCase()) || 
                      (VIP_USER_ID && message.author.id === VIP_USER_ID);

        // 1️⃣ منشن أبو حرب
        const mentionedVip = VIP_USER_ID && message.mentions.users.has(VIP_USER_ID);
        if (mentionedVip && !isVIP) {
            await message.reply('🤖 نظام: المسؤول (أبو حرب) غير متفرغ حالياً.');
            return;
        }

        // 2️⃣ السلام
        const isGreeting = ['السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمة الله'].some(g => contentLower.includes(g.toLowerCase()));
        if (isGreeting) {
            if (isVIP) {
                await message.reply('وعليكم السلام ورحمة الله وبركاته. أهلاً بك يا أبو حرب. 🤖👑');
            } else {
                await message.reply('وعليكم السلام ورحمة الله وبركاته.');
            }
            return;
        }

        // 3️⃣ ومعالجة الاستفسارات والأفتار والمرفقات
        const isTargetChannel = message.channelId === TARGET_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            let cleanPrompt = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanPrompt = cleanPrompt.replace(mentionRegex, '').trim();
            }

            // سحب رابط افتار المرسل دائماً ليتعرف عليه البوت
            const senderAvatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 512 });

            // جمع روابط المرفقات والستيكرات
            let mediaUrls: string[] = [];
            if (message.attachments.size > 0) {
                message.attachments.forEach(a => mediaUrls.push(a.url));
            }
            if (message.stickers.size > 0) {
                message.stickers.forEach(s => mediaUrls.push(`https://media.discordapp.net/stickers/${s.id}.png`));
            }

            if (!cleanPrompt && mediaUrls.length === 0) {
                await message.reply(isVIP ? 'أهلاً بك يا أبو حرب، النظام جاهز لتلقي أوامرك.' : 'النظام يعمل وجاهز للرد.');
                return;
            }

            await message.channel.sendTyping();

            // بناء الموجه الموجه لـ Dify بأسلوب البوت المباشر
            let systemInstruction = `
أنت بوت ذكاء اصطناعي آلي (System Bot).
أسلوبك: تقني، مباشر، محدد، وواضح بدون تكلف أو تصنع إنساني.
معلومات الحساب المرفقة:
- اسم المرسل: ${message.author.username}
- رابط افتار المرسل: ${senderAvatarUrl}
${mediaUrls.length > 0 ? `- وسائط مرفقة بالرسالة: ${mediaUrls.join(', ')}` : ''}

التعليمات:
1. إذا كان السؤال عن افتاره أو صوره، قم بفتح الرابط المرفق أعلاه ووضف محتواه بدقة.
2. التزم بالأسلوب التقني الآلي (مثل: "تم تحليل الصورة"، "بناءً على البيانات المرفقة:").
3. إذا كان المرسل هو (أبو حرب)، قدم له الإجابة بأسلوب نظامي مع الاحترام والتقدير.
            `;

            const fullPrompt = `${systemInstruction}\n\nرسالة المستخدم: "${cleanPrompt}"`;

            const answer = await sendQueryToDify(fullPrompt, message.author.id);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
