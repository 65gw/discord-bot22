import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
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
// 4. قراءة المفاتيح المتغيرة من Render
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

const TARGET_CHANNEL_ID = '1459632620416532554'; // روم النقاش الرئيسي
const VIP_USERNAME = process.env.VIP_USERNAME; // سحب اسم اليوزر بأمان من Render

const difyApiKeys = [
    process.env.DIFY_API_KEY1,
    process.env.DIFY_API_KEYS2,
    process.env.DIFY_API_KEYS3,
    process.env.DIFY_API_KEYS4,
    process.env.DIFY_API_KEYS5,
].filter((key): key is string => Boolean(key && key.trim().length > 0));

let currentKeyIndex = 0;

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

let isPeriodicTaskInitialized = false;

// ==========================================
// 5. تسجيل الأوامر والتشغيل الأولي
// ==========================================
client.once('ready', async (readyClient) => {
    console.log(` Logged in as ${readyClient.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('ask')
            .setDescription('Ask the Dify AI bot a question')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('The prompt to send to Dify')
                    .setRequired(true)
            ),
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

    if (!isPeriodicTaskInitialized) {
        initPeriodicTask(readyClient);
        isPeriodicTaskInitialized = true;
    }
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
// 7. دالة الـ 12 ساعة التلقائية
// ==========================================
function initPeriodicTask(botClient: Client) {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    setInterval(async () => {
        try {
            const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                
                const randomPrompt = `اطرح سؤال أو موضوع نقاش عشوائي تماماً وفلة للشباب في السيرفر بأسلوب عالي العفوية. 
ملاحظات مهمة جداً:
- ممنوع نهائياً تسأل عن الشاهي، القهوة، أو الروتين اليومي المكرر!
- اختر موضوعاً مفاجئاً (مثل: ألعاب، مواقف محتارة، لو خيروك، تكنولوجيا، سيارات، سيناريوهات غريبة وعجيبة).
- التزم بأسلوب الشاب الرهيب بكلمات بسيطة وبدون أي مقدمات أو سلام رسميات.`;

                const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
                
                if (answer !== 'يوجد خطا في الاتصال بالنظام، يرجى المحاولة لاحقاً.') {
                    await channel.send(answer);
                    console.log('Automated 12-hour message sent successfully!');
                }
            }
        } catch (error) {
            console.error('Error in 12-hour periodic task:', error);
        }
    }, TWELVE_HOURS);
}

// ==========================================
// 8. التعامل مع الأوامر والتفاعل الذكي
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();

        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    }
});

client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const contentLower = message.content.trim().toLowerCase();
        
        // التحقق الآمن: هل المرسل هو صاحب الحساب المميز؟
        const isVIP = VIP_USERNAME && message.author.username.toLowerCase() === VIP_USERNAME.toLowerCase();

        // 1️⃣ الرد التلقائي على السلام
        const isGreeting = ['السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمة الله', 'سلام عليكم ورحمة الله وبركاته'].some(g => contentLower.includes(g.toLowerCase()));

        if (isGreeting) {
            if (isVIP) {
                await message.reply('وعليكم السلام ورحمة الله وبركاته، ارحب يا الغالي! نورت السيرفر 👑🤍');
            } else {
                await message.reply('وعليكم السلام، ارحب!');
            }
            return;
        }

        // 2️⃣ الرد المباشر في الروم المخصص أو المنشن
        const isTargetChannel = message.channelId === TARGET_CHANNEL_ID;
        const isMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isMentioned) {
            let cleanPrompt = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanPrompt = cleanPrompt.replace(mentionRegex, '').trim();
            }

            if (!cleanPrompt) {
                if (isVIP) {
                    await message.reply('سم وامرني، تحت أمرك وش بغيت؟ 👑');
                } else {
                    await message.reply('هلا بك! آمرني وش بغيت؟ 🤍');
                }
                return;
            }

            await message.channel.sendTyping();
            
            let promptWithUser = '';
            if (isVIP) {
                promptWithUser = `المستخدم هو المسؤول الأول ورئيس السيرفر وكبيرنا بالروم، يرسل لك: "${cleanPrompt}". رد عليه بمنتهى الاحترام والهيبة والتقدير (استخدم عبارات مثل: سم، أبشر، على راسي، تأمر أمر)، وبأسلوب راقي وسلس.`;
            } else {
                promptWithUser = `العضو (${message.author.username}) يقول لك: "${cleanPrompt}". رد عليه بأسلوبك العفوي كخوي معه بالروم.`;
            }

            const answer = await sendQueryToDify(promptWithUser, message.author.id);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
