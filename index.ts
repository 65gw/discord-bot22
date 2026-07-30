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

    // تشغيل التنبيه المجدول مرة واحدة عند إقلاع البوت
    if (!isPeriodicTaskInitialized) {
        initPeriodicTask(readyClient);
        isPeriodicTaskInitialized = true;
    }
});

// ==========================================
// 6. دالة الاتصال بـ Dify API (صامتة عند الخطأ)
// ==========================================
async function sendQueryToDify(prompt: string, userId: string): Promise<string | null> {
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

        let answer = response.data.answer || null;
        if (answer && answer.length > 2000) {
            answer = answer.substring(0, 1990) + '...\n*(الرد مقصوص لكبر الحجم)*';
        }
        return answer;
    } catch (error: any) {
        // طباعة الخطأ في السيرفر فقط بدون إرجاع نص خطأ للديسكورد
        console.error('Dify API Error:', error.response?.data || error.message);
        return null;
    }
}

// ==========================================
// 7. دالة الـ 3 ساعات للروم المحدد (سوالف عشوائية)
// ==========================================
function initPeriodicTask(botClient: Client) {
    const TARGET_CHANNEL_ID = '1459632620416532554';
    const THREE_HOURS = 3 * 60 * 60 * 1000; // كل 3 ساعات

    setInterval(async () => {
        try {
            const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
                const messages = await channel.messages.fetch({ limit: 1 });
                const lastMessage = messages.first();
                
                let randomPrompt = '';
                if (lastMessage && !lastMessage.author.bot) {
                    randomPrompt = `هذي آخر رسالة انكتبت بالروم من العضو (${lastMessage.author.username}): "${lastMessage.content}". علق عليها بأسلوبك السلس أو اطرح موضوع عشوائي جديد وفلة وسؤال حماسي للشباب بالروم بدون مقدمات رسمية.`;
                } else {
                    randomPrompt = "اطرح موضوع نقاش عشوائي ممتع أو سؤال فلة وحماسي للشباب في سيرفر الديسكورد بأسلوبك العفوي وبدون مقدمات رسمية.";
                }

                const answer = await sendQueryToDify(randomPrompt, 'cron_3h_system');
                
                // الإرسال فقط إذا نجح الذكاء الاصطناعي في إرجاع رد
                if (answer) {
                    await channel.send(answer);
                    console.log('Automated 3-hour message sent successfully!');
                } else {
                    console.log('تم تجاهل الإرسال التلقائي بسبب عدم استجابة Dify (تم الحفاظ على هدوء الروم).');
                }
            }
        } catch (error) {
            console.error('Error in 3-hour periodic task:', error);
        }
    }, THREE_HOURS);
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
        if (answer) {
            await interaction.editReply(answer);
        } else {
            await interaction.deleteReply().catch(() => {});
        }
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
            
            // رد فقط إذا كان هناك رد سليم
            if (answer) {
                await message.reply(answer);
            }
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

// تسجيل الدخول للديسكورد
client.login(token);
