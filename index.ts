import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// ==========================================
// 1. نظام الحماية الفولاذي من الكراش
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
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
// 4. قراءة المفاتيح وإعدادات الإعدادات المتغيرة
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

// متغيرات التحكم بالحالة (State Management)
let isAutoTopicsEnabled = true; // تشغيل/إيقاف المواضيع التلقائية
let humanModeEnabled = true; // نمط المحاكاة البشرية (واقعي)
let roastLevel: 'mild' | 'medium' | 'savage' = 'savage'; // مستوى الجلد والزبدة
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
            .setName('mode')
            .setDescription('تغيير أسلوب وشخصية البوت')
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('اختر النمط')
                    .setRequired(true)
                    .addChoices(
                        { name: 'إنساني طبيعي (عفوي وواقعي جدًا)', value: 'human' },
                        { name: 'بوت رسمي ومباشر', value: 'bot' }
                    )
            ),
        new SlashCommandBuilder()
            .setName('roast-level')
            .setDescription('تحديد حدة الزبدة والطقطقة عند الاستهزاء')
            .addStringOption(option =>
                option.setName('level')
                    .setDescription('مستوى الجلد')
                    .setRequired(true)
                    .addChoices(
                        { name: 'خفيف (طقطقة خفيفة)', value: 'mild' },
                        { name: 'متوسط', value: 'medium' },
                        { name: 'شرس (جلد ومسح جبهات)', value: 'savage' }
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
// 6. الاتصال والتداول المنفصل والـ Fallback
// ==========================================
async function sendQueryToDify(prompt: string, userId: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    while (attempts < totalKeys) {
        const keyToUse = difyApiKeys[currentKeyIndex];
        const keyNumber = currentKeyIndex + 1;

        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            console.log(` [Dify] Trying Separate Key #${keyNumber}...`);
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
                console.log(` [Dify] Success using Separate Key #${keyNumber}!`);
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify] Separate Key #${keyNumber} failed:`, error.response?.data?.message || error.message);
        }

        attempts++;
    }

    console.error(` [Dify] All ${totalKeys} separate keys failed.`);
    return 'يوجد خطا في الاتصال بالنظام، يرجى المحاولة لاحقاً.';
}

// ==========================================
// 7. دالة المواضيع التلقائية (12 ساعة)
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `افتح موضوعاً عشوائياً وشاطحاً تماماً مع الشباب في السيرفر.
ملاحظات صارمة:
- ممنوع كلياً الكلام عن (قطع البي سي، البي سي، الشاهي، القهوة، أو الروتين اليومي).
- اختر موضوعاً غريباً أو شطحة عشوائية جداً من أي مكان بالدنيا (مواقف، سيناريوهات غريبة، ألعاب، تخيلات، مواقف مضحكة).
- ادخل في الموضوع مباشرة بأسلوب شاب عفوي بدون سلام ولا مقدمات ولا فلسفة الذكاء الاصطناعي.`;

            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            
            if (answer !== 'يوجد خطا في الاتصال بالنظام، يرجى المحاولة لاحقاً.') {
                await channel.send(answer);
                console.log('Automated 12-hour message sent successfully!');
            }
        }
    } catch (error) {
        console.error('Error in periodic topic trigger:', error);
    }
}

function startPeriodicTask(botClient: Client) {
    if (periodicTimer) clearInterval(periodicTimer);

    const TWELVE_HOURS = 12 * 60 * 60 * 1000; // نظام الـ 12 ساعة حسب طلبك

    periodicTimer = setInterval(() => {
        if (isAutoTopicsEnabled) {
            triggerRandomTopic(botClient);
        }
    }, TWELVE_HOURS);
}

// ==========================================
// 8. التعامل مع أومر الـ Slash Commands
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
    else if (commandName === 'auto-topics') {
        const status = interaction.options.getString('status', true);
        if (status === 'enable') {
            isAutoTopicsEnabled = true;
            await interaction.reply('✅ تم **تشغيل** المواضيع التلقائية كل 12 ساعة بنجاح!');
        } else {
            isAutoTopicsEnabled = false;
            await interaction.reply('🛑 تم **إيقاف** المواضيع التلقائية نهائياً. لن يرسل البوت أي شطحات تلقائية بعد الآن.');
        }
    }
    else if (commandName === 'mode') {
        const modeType = interaction.options.getString('type', true);
        if (modeType === 'human') {
            humanModeEnabled = true;
            await interaction.reply('🎭 تم تحويل النمط إلى **إنساني طبيعي** (يسولف بأسلوب عفوي وشبابي كأنه شخص واقعي).');
        } else {
            humanModeEnabled = false;
            await interaction.reply('🤖 تم تحويل النمط إلى **بوت رسمي ومباشر**.');
        }
    }
    else if (commandName === 'roast-level') {
        const level = interaction.options.getString('level', true) as 'mild' | 'medium' | 'savage';
        roastLevel = level;
        const levelNames = { mild: 'خفيف 😅', medium: 'متوسط ⚖️', savage: 'شرس ومسح جبهات 🔥' };
        await interaction.reply(`🔥 تم تعديل مستوى الزبدة والطقطقة إلى: **${levelNames[level]}**`);
    }
    else if (commandName === 'topic-now') {
        await interaction.reply({ content: '⏳ جاري إرسال موضوع شاطح للروم...', ephemeral: true });
        await triggerRandomTopic(client);
    }
});

// ==========================================
// 9. التعامل مع الرسائل والمنشن والسلام
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const contentLower = message.content.trim().toLowerCase();
        const isVIP = (VIP_USERNAME && message.author.username.toLowerCase() === VIP_USERNAME.toLowerCase()) || 
                      (VIP_USER_ID && message.author.id === VIP_USER_ID);

        // 🎯 1️⃣ رد تلقائي وعشوائي عند منشن أبو حرب
        const mentionedVip = VIP_USER_ID && message.mentions.users.has(VIP_USER_ID);
        if (mentionedVip && !isVIP) {
            const vipReplies = [
                'سم وش تبي من ابو حرب؟ 🤔',
                'لا تكلم عمك قبل تاخذ موعد ✋🛑',
                'هلا انا نائبه وش تبي؟ 🫡'
            ];
            const randomReply = vipReplies[Math.floor(Math.random() * vipReplies.length)];
            await message.reply(randomReply);
            return;
        }

        // 2️⃣ الرد التلقائي على السلام
        const isGreeting = ['السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمة الله', 'سلام عليكم ورحمة الله وبركاته'].some(g => contentLower.includes(g.toLowerCase()));

        if (isGreeting) {
            if (isVIP) {
                await message.reply('وعليكم السلام ورحمة الله وبركاته، ارحب يا أبو حرب! نورت السيرفر 👑🤍');
            } else {
                await message.reply('وعليكم السلام، ارحب!');
            }
            return;
        }

        // 3️⃣ الرد المباشر في الروم المخصص أو منشن البوت نفسه
        const isTargetChannel = message.channelId === TARGET_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            let cleanPrompt = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanPrompt = cleanPrompt.replace(mentionRegex, '').trim();
            }

            if (!cleanPrompt) {
                if (isVIP) {
                    await message.reply('سم وامرني يا أبو حرب، تحت أمرك وش بغيت؟ 👑');
                } else {
                    await message.reply('هلا بك! آمرني وش بغيت؟ 🤍');
                }
                return;
            }

            await message.channel.sendTyping();
            
            let promptWithUser = '';
            if (isVIP) {
                promptWithUser = `المستخدم هو (أبو حرب) راعي السيرفر وكبيرنا بالروم، يرسل لك: "${cleanPrompt}". 
رد عليه بمنتهى الاحترام وهيبة ولقبه دائماً بـ (أبو حرب) واستخدم عبارات تقدير، واجعل كلامك موجزاً ومباشراً بدون فلسفة زايدة.`;
            } else {
                const humanStylePrompt = humanModeEnabled 
                    ? `- اكتب بأسلوب شخص واقعي حقيقي وسولف بعفوية تامة. نوع باستخدام كلمات عامية شبابية مختصرة، وبدون تنسيقات أو تنقيط مبالغ فيه لكتابة الذكاء الاصطناعي.` 
                    : `- أجب كبوت ذكي ومباشر.`;

                const roastStylePrompt = roastLevel === 'savage' 
                    ? `إذا كان فيه أي طقطقة أو استهزاء: افصل عليه فوراً واجلده بأسلوب شرس وتزبييد قوي يمسح جبهته!` 
                    : roastLevel === 'medium' 
                    ? `إذا كان فيه استهزاء: زبّد له بشكل متوسط وبطقطقة خفيفة.`
                    : `إذا كان فيه استهزاء: رد بطقطقة بسيطة وبدون هجوم قوي.`;

                promptWithUser = `العضو (${message.author.username}) يقول لك: "${cleanPrompt}".
تعليمات التعامل والشخصية:
1. أنت خوي معهم بالسيرفر.
${humanStylePrompt}
2. إذا كان كلام العضو عادي أو سؤال طبيعي: رد عليه عادي بأسلوب خوي وسولف معه باختصار.
3. إذا حسيت إن كلامه فيه (طقطقة عليك، مسخرة، استهزاء، استظراف، أو ضحك عليك): 
${roastStylePrompt}`;
            }

            const answer = await sendQueryToDify(promptWithUser, message.author.id);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
