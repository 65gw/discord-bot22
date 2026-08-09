import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// ==========================================
// 1. نظام الحماية من الكراش
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
// 3. نظام Keep-Alive
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';

setInterval(async () => {
    try {
        await axios.get(RENDER_URL, { timeout: 10000 });
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
let isAutoTopicsEnabled = true; 
let periodicTimer: NodeJS.Timeout | null = null;

if (!token || difyApiKeys.length === 0) {
    console.error(' Error: Missing Tokens/Keys!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ==========================================
// 5. تسجيل الأوامر
// ==========================================
client.once('ready', async (readyClient) => {
    console.log(` Logged in as ${readyClient.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('ask')
            .setDescription('سؤال البوت باختصار')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('الرسالة')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('auto-topics')
            .setDescription('تشغيل/إيقاف المواضيع التلقائية')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('الحالة')
                    .setRequired(true)
                    .addChoices(
                        { name: 'تشغيل (كل 12 ساعة)', value: 'enable' },
                        { name: 'إيقاف نهائي', value: 'disable' }
                    )
            ),
        new SlashCommandBuilder()
            .setName('topic-now')
            .setDescription('طرح موضوع فوري'),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands },
        );
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    startPeriodicTask(readyClient);
});

// ==========================================
// 6. الاتصال بـ Dify ودعم الـ Vision
// ==========================================
async function sendQueryToDify(prompt: string, userId: string, imageUrl?: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    // تجهيز الملف لمودل الـ Vision في Dify إذا وُجد رابط صورة
    const files = imageUrl ? [
        {
            type: 'image',
            transfer_method: 'remote_url',
            url: imageUrl
        }
    ] : [];

    while (attempts < totalKeys) {
        const keyToUse = difyApiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            const response = await axios.post(
                `${difyBaseUrl}/chat-messages`,
                {
                    inputs: {},
                    query: prompt,
                    response_mode: 'blocking',
                    user: userId,
                    files: files
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
                // اقتطاع الرد لضمان عدم تجاوز سطرين في حال خالف البوت التعليمات
                const lines = answer.trim().split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 2) {
                    answer = lines.slice(0, 2).join('\n');
                }
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify] Error:`, error.response?.data?.message || error.message);
        }

        attempts++;
    }

    return 'خطأ بالاتصال بالنظام.';
}

// ==========================================
// 7. المواضيع التلقائية
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `اطرح موضوعاً عشوائياً وغريباً بنص قصير جداً (سطر واحد فقط). ممنوع المقدمات أو الترحيب.`;
            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            if (!answer.startsWith('خطأ')) {
                await channel.send(answer);
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

// ==========================================
// 8. أوامر الـ Slash
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();
        const answer = await sendQueryToDify(`أجب على التالي باختصار شديد في سطر واحد فقط:\n${prompt}`, interaction.user.id);
        await interaction.editReply(answer);
    } 
    else if (interaction.commandName === 'auto-topics') {
        const status = interaction.options.getString('status', true);
        isAutoTopicsEnabled = (status === 'enable');
        await interaction.reply(`تم ${isAutoTopicsEnabled ? 'تشغيل' : 'إيقاف'} المواضيع التلقائية.`);
    }
    else if (interaction.commandName === 'topic-now') {
        await interaction.reply({ content: 'جاري الإرسال...', ephemeral: true });
        await triggerRandomTopic(client);
    }
});

// ==========================================
// 9. معالجة الرسائل والافتار بصرامـة
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const contentLower = message.content.trim().toLowerCase();
        const isVIP = (VIP_USERNAME && message.author.username.toLowerCase() === VIP_USERNAME.toLowerCase()) || 
                      (VIP_USER_ID && message.author.id === VIP_USER_ID);

        // منشن أبو حرب
        const mentionedVip = VIP_USER_ID && message.mentions.users.has(VIP_USER_ID);
        if (mentionedVip && !isVIP) {
            await message.reply('أبو حرب غير متفرغ حالياً.');
            return;
        }

        // السلام
        const isGreeting = ['السلام عليكم', 'سلام عليكم'].some(g => contentLower.includes(g));
        if (isGreeting) {
            await message.reply(isVIP ? 'وعليكم السلام يا أبو حرب.' : 'وعليكم السلام.');
            return;
        }

        const isTargetChannel = message.channelId === TARGET_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            let cleanPrompt = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanPrompt = cleanPrompt.replace(mentionRegex, '').trim();
            }

            // سحب رابط الصورة سواء كانت أفتار أو مرفق
            let targetImageUrl: string | undefined = undefined;

            if (message.attachments.size > 0) {
                targetImageUrl = message.attachments.first()?.url;
            } else if (message.stickers.size > 0) {
                targetImageUrl = `https://media.discordapp.net/stickers/${message.stickers.first()?.id}.png`;
            } else if (cleanPrompt.includes('افتار') || cleanPrompt.includes('الافتار') || cleanPrompt.includes('صورة')) {
                // إجبار سحب افتار المستخدم فوراً إذا ذكر كلمة "افتار"
                targetImageUrl = message.author.displayAvatarURL({ extension: 'png', size: 512 });
            }

            if (!cleanPrompt && !targetImageUrl) {
                await message.reply(isVIP ? 'سم يا أبو حرب، آمر.' : 'هلا بك.');
                return;
            }

            await message.channel.sendTyping();

            // تعليمات صريحة ومختصرة جداً
            const strictInstructions = `
[تعليمات النظام]
1. أجب بأسلوب تقني مقتضب ومباشر جداً.
2. حد الأجابة الأقصى: سطر أو سطرين فقط! يمنع كلياً الإطالة أو الفلسفة أو استخدام عبارات الترحيب والمجاملة الزائدة.
3. إذا وُجدت صورة مرفقة، افحصها وصِفها باختصار وبشكل مباشر.
            `;

            const fullPrompt = `${strictInstructions}\nالمستخدم (${message.author.username}): ${cleanPrompt}`;

            const answer = await sendQueryToDify(fullPrompt, message.author.id, targetImageUrl);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
