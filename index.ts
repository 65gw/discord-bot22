import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// ==========================================
// 1. نظام الحماية الفولاذي من الكراش والطفي
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error(' [حماية] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error(' [حماية] Uncaught Exception:', err);
});

// ==========================================
// 2. سيرفر الويب لخدمة Render و UptimeRobot (يقبل 200 OK)
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
// 3. نظام الـ Self-Ping المطور (يدعم HTTPS)
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';

setInterval(async () => {
    try {
        await axios.get(RENDER_URL, { timeout: 10000 });
        console.log(' [Keep-Alive] Self-ping successful!');
    } catch (err: any) {
        console.error(' [Keep-Alive] Self-ping failed:', err.message);
    }
}, 8 * 60 * 1000); // ينغز السيرفر كل 8 دقائق لضمان عدم النوم

// ==========================================
// 4. إعدادات الديسكورد و Dify
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyApiKey = process.env.DIFY_API_KEY;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

if (!token || !difyApiKey) {
    console.error(' Error: DISCORD_BOT_TOKEN or DIFY_API_KEY is missing in .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let isDailyTaskInitialized = false;

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

    // تشغيل التنبيه اليومي مرة واحدة فقط لمنع استهلاك الذاكرة
    if (!isDailyTaskInitialized) {
        initDailyTask(readyClient);
        isDailyTaskInitialized = true;
    }
});

// ==========================================
// 6. دالة الاتصال بـ Dify API
// ==========================================
async function sendQueryToDify(prompt: string, userId: string): Promise<string> {
    try {
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
                    'Authorization': `Bearer ${difyApiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 25000
            }
        );

        let answer = response.data.answer || 'لم يتم استلام رد من الذكاء الاصطناعي.';
        if (answer.length > 2000) {
            answer = answer.substring(0, 1990) + '...\n*(الرد مقصوص لكبر الحجم)*';
        }
        return answer;
    } catch (error: any) {
        console.error('Dify API Error:', error.response?.data || error.message);
        return 'عذراً، حدث خطأ مؤقت أثناء الاتصال بالذكاء الاصطناعي.';
    }
}

// ==========================================
// 7. دالة الـ 24 ساعة للروم المحدد
// ==========================================
function initDailyTask(botClient: Client) {
    const TARGET_CHANNEL_ID = '1459632620416532554';
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    setInterval(async () => {
        try {
            const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const messages = await channel.messages.fetch({ limit: 1 });
                const lastMessage = messages.first();
                
                let dailyPrompt = '';
                if (lastMessage && !lastMessage.author.bot) {
                    dailyPrompt = `هذي آخر رسالة انكتبت في الروم من العضو (${lastMessage.author.username}): "${lastMessage.content}". ابدأ السالفة أو اعلق عليها بطريقتك المعتادة (أو اطرح موضوع جديد ومنوع وحماسي للشباب لو ما عجبتك السالفة)، وخل ردك عفوي ومباشر بدون مقدمات طويلة.`;
                } else {
                    dailyPrompt = "اطرح موضوع نقاش منوع وحماسي أو سالفة جديدة تسلي الشباب في السيرفر اليوم بشكل عفوي ومباشر.";
                }

                const answer = await sendQueryToDify(dailyPrompt, 'daily_cron_system');
                await channel.send(answer);
                console.log('Daily automated message sent successfully!');
            }
        } catch (error) {
            console.error('Error in daily cron task:', error);
        }
    }, TWENTY_FOUR_HOURS);
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
                await message.reply('هلا بك يا أبو حرب! آمرني وش بغيت؟ 🤍');
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

// تسجيل الدخول للديسكورد
client.login(token);
