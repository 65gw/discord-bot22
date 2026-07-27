import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// حماية البوت من الكراش والطفي المفاجئ عند حدوث أي خطأ غير متوقع
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});

// 1. إعداد سيرفر وهمي لفتح الـ Port لـ Render
const PORT = process.env.PORT || 3000;
http.createServer((_, res) => {
    res.write('Bot is alive!');
    res.end();
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// 2. كود الـ Self-Ping لمنع Render من وضع الخمول
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';

setInterval(() => {
    http.get(RENDER_URL, (res) => {
        console.log(`Self-ping status code: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Self-ping failed:', err.message);
    });
}, 10 * 60 * 1000); // كل 10 دقائق

const token = process.env.DISCORD_BOT_TOKEN;
const difyApiKey = process.env.DIFY_API_KEY;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

if (!token || !difyApiKey) {
    console.error('Error: DISCORD_BOT_TOKEN or DIFY_API_KEY is missing in .env file.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // ضروري لقراءة محتوى الرسائل والمنشنات
    ],
});

// تسجيل الأوامر والتنبيه عند التشغيل + تشغيل نظام الـ 24 ساعة
client.once('clientReady', async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);

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
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    // تشغيل التنبيه اليومي
    initDailyTask(readyClient);
});

// دالة موحدة لإرسال الطلبات إلى Dify
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

        let answer = response.data.answer || 'No response received from Dify.';
        if (answer.length > 2000) {
            answer = answer.substring(0, 1990) + '...\n*(الرد مقصوص لكبر الحجم)*';
        }
        return answer;
    } catch (error: any) {
        console.error('Dify API Error:', error.response?.data || error.message);
        return 'عذراً، حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.';
    }
}

// دالة الـ 24 ساعة للروم المحدد
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

// 1. التعامل مع أمر /ask
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();

        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    }
});

// 2. التعامل مع المنشن المباشر في أي روم (مع حماية Try/Catch)
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        if (client.user && message.mentions.has(client.user)) {
            // تنظيف المنشن بأسلوب ديسكورد الصحيح <@ID> أو <@!ID>
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

client.login(token);
