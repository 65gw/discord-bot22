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
// 4. قراءة المفاتيح المفصلة من Render (الـ 5 مفاتيح)
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

// قراءة المفاتيح المطابقة تماماً لأسماء المتغيرات الموجودة في Render
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

        // الانتقال للمفتاح التالي بالتدوير التلقائي
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
// 7. دالة الـ 12 ساعة للروم المحدد (موضوع عشوائي)
// ==========================================
function initPeriodicTask(botClient: Client) {
    const TARGET_CHANNEL_ID = '1459632620416532554';
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    setInterval(async () => {
        try {
            const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                
                // برومبت عشوائي تماماً وبدون النظر للرسائل السابقة
                const randomPrompt = "اطرح موضوع نقاش عشوائي تماماً وممتع، أو سؤال فلة وحماسي للشباب في سيرفر الديسكورد بأسلوبك العفوي والسلس وبدون أي مقدمات رسمية.";

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
// 8. التعامل مع الأوامر والمنشن
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

        if (client.user && message.mentions.has(client.user)) {
            const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
            const cleanPrompt = message.content.replace(mentionRegex, '').trim();
            
            if (!cleanPrompt) {
                await message.reply('هلا بك! آمرني وش بغيت؟ 🤍');
                return;
            }

            await message.channel.sendTyping();
            const answer = await sendQueryToDify(cleanPrompt, message.author.id);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
