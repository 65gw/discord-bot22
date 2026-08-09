import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    TextChannel
} from 'discord.js';
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
let isSavageModeEnabled = true; // تفعيل نمط قلة الأدب والطقطقة كوضع افتراضي
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
        GatewayIntentBits.GuildMembers,
    ],
});

// ==========================================
// 5. تسجيل أوامر Slash الجديدة
// ==========================================
client.once('ready', async (readyClient) => {
    console.log(` Logged in as ${readyClient.user.tag}!`);

    const commands = [
        // أمر السؤال
        new SlashCommandBuilder()
            .setName('ask')
            .setDescription('سؤال البوت باختصار')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('الرسالة')
                    .setRequired(true)
            ),

        // أمر إرسال رسالة بالخاص (DM)
        new SlashCommandBuilder()
            .setName('dm')
            .setDescription('إرسال رسالة خاصة إلى عضو محدد عبر البوت')
            .addUserOption(option => 
                option.setName('target')
                    .setDescription('العضو المستهدف')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option.setName('message')
                    .setDescription('محتوى الرسالة')
                    .setRequired(true)
            ),

        // أمر التبديل بين نمط الطقطقة والنمط العادي
        new SlashCommandBuilder()
            .setName('bot-mode')
            .setDescription('التحكم في أسلوب البوت وطقطقته')
            .addStringOption(option =>
                option.setName('mode')
                    .setDescription('اختر أسلوب البوت')
                    .setRequired(true)
                    .addChoices(
                        { name: '🔥 شرس وطقطقة (سavage)', value: 'savage' },
                        { name: '🤖 تقني وجاد فقط (Technical)', value: 'polite' }
                    )
            ),

        // أمر التحكم في المواضيع التلقائية
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

        // أمر طرح موضوع فوري
        new SlashCommandBuilder()
            .setName('topic-now')
            .setDescription('طرح موضوع فوري'),

        // --- أوامر الحماية والإدارة ---
        new SlashCommandBuilder()
            .setName('purge')
            .setDescription('مسح عدد معين من الرسائل للحماية')
            .addIntegerOption(option => 
                option.setName('amount')
                    .setDescription('عدد الرسائل (1-100)')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('طرد عضو مخالف من السيرفر')
            .addUserOption(option => option.setName('user').setDescription('العضو').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('السبب'))
            .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('حظر عضو مخالف من السيرفر')
            .addUserOption(option => option.setName('user').setDescription('العضو').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('السبب'))
            .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

        // --- أوامر معلومات السيرفر والمستخدم ---
        new SlashCommandBuilder()
            .setName('user-info')
            .setDescription('عرض معلومات عن مستخدم')
            .addUserOption(option => option.setName('target').setDescription('المستخدم')),

        new SlashCommandBuilder()
            .setName('server-info')
            .setDescription('عرض معلومات حماية وإحصائيات السيرفر')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands },
        );
        console.log('✅ تم تسجيل جميع أوامر الـ Slash بنجاح!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    startPeriodicTask(readyClient);
});

// ==========================================
// 6. الاتصال بـ Dify ودعم الـ Vision المتقدم
// ==========================================
async function sendQueryToDify(prompt: string, userId: string, imageUrl?: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

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
                // تقليم الرد في حالة السوالف العامة فقط
                const lines = answer.trim().split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 3 && !prompt.includes('برمجة') && !prompt.includes('كود')) {
                    answer = lines.slice(0, 3).join('\n');
                }
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify] Error:`, error.response?.data?.message || error.message);
        }

        attempts++;
    }

    return 'خطأ بالنظام، حاول لاحقاً.';
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
                await (channel as TextChannel).send(answer);
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
// 8. معالجة أوامر الـ Slash
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. أمر /ask
    if (commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();
        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    } 

    // 2. أمر /dm لإرسال رسالة خاصة
    else if (commandName === 'dm') {
        const targetUser = interaction.options.getUser('target', true);
        const messageText = interaction.options.getString('message', true);

        try {
            await targetUser.send(`📩 **رسالة خاصة قادمة لك:**\n${messageText}`);
            await interaction.reply({ content: `✅ تم إرسال الرسالة الخاصة إلى ${targetUser.tag} بنجاح!`, ephemeral: true });
        } catch (err) {
            await interaction.reply({ content: `❌ لم أتمكن من إرسال رسالة خاصة إلى ${targetUser.tag} (قد تكون الخاص لديه مغلقة).`, ephemeral: true });
        }
    }

    // 3. أمر /bot-mode للتحكم في نمط الطقطقة
    else if (commandName === 'bot-mode') {
        const mode = interaction.options.getString('mode', true);
        isSavageModeEnabled = (mode === 'savage');
        await interaction.reply(`🔥 تم تعديل نمط البوت إلى: **${isSavageModeEnabled ? 'النمط الشرس والطقطقة' : 'النمط التقني المحترم'}**`);
    }

    // 4. أمر /auto-topics
    else if (commandName === 'auto-topics') {
        const status = interaction.options.getString('status', true);
        isAutoTopicsEnabled = (status === 'enable');
        await interaction.reply(`تم ${isAutoTopicsEnabled ? 'تشغيل' : 'إيقاف'} المواضيع التلقائية.`);
    }

    // 5. أمر /topic-now
    else if (commandName === 'topic-now') {
        await interaction.reply({ content: 'جاري الإرسال...', ephemeral: true });
        await triggerRandomTopic(client);
    }

    // 6. أمر /purge لتنظيف الشات
    else if (commandName === 'purge') {
        const amount = interaction.options.getInteger('amount', true);
        if (amount < 1 || amount > 100) {
            await interaction.reply({ content: 'يرجى إدخال رقم بين 1 و 100.', ephemeral: true });
            return;
        }
        if (interaction.channel && 'bulkDelete' in interaction.channel) {
            await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `🧹 تم مسح ${amount} رسالة بنجاح!`, ephemeral: true });
        }
    }

    // 7. أمر /kick
    else if (commandName === 'kick') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب مذكور';
        const member = await interaction.guild?.members.fetch(user.id);
        if (member) {
            await member.kick(reason);
            await interaction.reply({ content: `👞 تم طرد العضو ${user.tag} السبب: ${reason}` });
        }
    }

    // 8. أمر /ban
    else if (commandName === 'ban') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب مذكور';
        await interaction.guild?.members.ban(user.id, { reason });
        await interaction.reply({ content: `🔨 تم حظر العضو ${user.tag} السبب: ${reason}` });
    }

    // 9. أمر /user-info
    else if (commandName === 'user-info') {
        const user = interaction.options.getUser('target') || interaction.user;
        await interaction.reply({
            content: `👤 **معلومات المستخدم:**\n• الاسم: **${user.tag}**\n• الـ ID: \`${user.id}\`\n• تاريخ إنشاء الحساب: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
        });
    }

    // 10. أمر /server-info
    else if (commandName === 'server-info') {
        const guild = interaction.guild;
        if (!guild) return;
        await interaction.reply({
            content: `🏰 **معلومات السيرفر:**\n• اسم السيرفر: **${guild.name}**\n• إجمالي الأعضاء: **${guild.memberCount}**\n• المالك: <@${guild.ownerId}>`
        });
    }
});

// ==========================================
// 9. معالجة الرسائل والافتارات والاستيكرات والـ GIF
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const contentLower = message.content.trim().toLowerCase();
        const isVIP = (VIP_USERNAME && message.author.username.toLowerCase() === VIP_USERNAME.toLowerCase()) || 
                      (VIP_USER_ID && message.author.id === VIP_USER_ID);

        // منشن VIP (أبو حرب)
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

            // --- التقاط روابط الصور، الاستيكرات، GIF، والأفتارات ---
            let targetImageUrl: string | undefined = undefined;

            // 1. المرفقات (صور + GIF)
            if (message.attachments.size > 0) {
                targetImageUrl = message.attachments.first()?.url;
            } 
            // 2. الاستيكرات
            else if (message.stickers.size > 0) {
                targetImageUrl = `https://media.discordapp.net/stickers/${message.stickers.first()?.id}.png`;
            } 
            // 3. الأفتار عند طلب فحص افتار شخص أو افتار العضو نفسه
            else if (cleanPrompt.includes('افتار') || cleanPrompt.includes('الافتار') || cleanPrompt.includes('صورة')) {
                const mentionedUser = message.mentions.users.first();
                if (mentionedUser) {
                    targetImageUrl = mentionedUser.displayAvatarURL({ extension: 'png', size: 512 });
                } else {
                    targetImageUrl = message.author.displayAvatarURL({ extension: 'png', size: 512 });
                }
            }

            if (!cleanPrompt && !targetImageUrl) {
                await message.reply(isVIP ? 'سم يا أبو حرب، آمر.' : 'هلا بك.');
                return;
            }

            await message.channel.sendTyping();

            // تعليمات صريحة تناسب نمط قلة الأدب والطقطقة والجانب التقني
            const strictInstructions = `
[قواعد الشخصية والرد]
1. البرمجة والتقنية: إذا تسأل عن برمجة أو أكواد أو مواضيع تقنية، اشرح بأسلوب تقني مفصل وبراحتك.
2. السوالف العادية: اختصر جداً في سطر أو سطرين فقط بدون مجاملات.
3. التصدّي للإساءة والطقطقة (${isSavageModeEnabled ? 'مُفعّل أقصى قوة' : 'عادي'}): إذا سبك أحد أو طقطق عليك، رد عليه فوراً بأشرس وأقوى طريقة طقطقة وسخرية ممكنة، وألجمه وخله أضحوكة بدون رحمة!
4. احترام خاص: إذا كان المستخدم هو أبو حرب (VIP)، تعامل معه باحترام كامل بدون أي طقطقة.
5. المرفقات والصور والافتارات: إذا وُجدت صورة أو GIF أو أفتار، افحص محتواها وعبّر عنه باختصار شديد وسخرية إذا كان مناسباً.
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
