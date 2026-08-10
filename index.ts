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

const difyApiKeys = [
    process.env.DIFY_API_KEY1,
    process.env.DIFY_API_KEYS2,
    process.env.DIFY_API_KEYS3,
    process.env.DIFY_API_KEYS4,
    process.env.DIFY_API_KEYS5,
].filter((key): key is string => Boolean(key && key.trim().length > 0));

let currentKeyIndex = 0;
let isAutoTopicsEnabled = true; 
let isSavageModeEnabled = false; // افتراضياً نخليه تقني وجاد
let isHumanPersona = true; 
let isChatRespondingEnabled = true; 
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
// 5. تسجيل أوامر Slash
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

        new SlashCommandBuilder()
            .setName('chat-toggle')
            .setDescription('تشغيل أو إيقاف رد البوت التلقائي في الشات')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('اختر الحالة')
                    .setRequired(true)
                    .addChoices(
                        { name: '🟢 تفعيل الردود بالشات', value: 'enable' },
                        { name: '🔴 إيقاف الردود بالشات', value: 'disable' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('mod')
            .setDescription('التحكم بشخصية البوت (هل يتصرف كـ إنسان أم كـ بوت؟)')
            .addStringOption(option =>
                option.setName('persona')
                    .setDescription('اختر أسلوب الشخصية')
                    .setRequired(true)
                    .addChoices(
                        { name: '👤 إنسان حقيقي (لا يعترف بكونه بوت)', value: 'human' },
                        { name: '🤖 بوت ذكي (يعترف بكونه برنامج/بوت)', value: 'bot' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('bot-mode')
            .setDescription('التحكم في أسلوب البوت مع الأعضاء والـ VIP')
            .addStringOption(option =>
                option.setName('mode')
                    .setDescription('اختر أسلوب البوت')
                    .setRequired(true)
                    .addChoices(
                        { name: '🔥 شرس وطقطقة (Savage) - يطقطق على الجميع بما فيهم VIP', value: 'savage' },
                        { name: '🤖 تقني وجاد فقط (Technical) - يطقطق على الكل إلا VIP محترم معه', value: 'polite' }
                    )
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
// 6. الاتصال بـ Dify مع دعم الـ Vision
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
            const payload: any = {
                inputs: {},
                query: prompt,
                response_mode: 'blocking',
                user: userId,
            };

            if (files.length > 0) {
                payload.files = files;
            }

            const response = await axios.post(
                `${difyBaseUrl}/chat-messages`,
                payload,
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
                const lines = answer.trim().split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 3 && !prompt.includes('برمجة') && !prompt.includes('كود')) {
                    answer = lines.slice(0, 3).join('\n');
                }
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify Error Key ${currentKeyIndex}]:`, error.response?.data || error.message);
            
            if (files.length > 0) {
                try {
                    const fallbackResponse = await axios.post(
                        `${difyBaseUrl}/chat-messages`,
                        {
                            inputs: {},
                            query: prompt,
                            response_mode: 'blocking',
                            user: userId
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${keyToUse}`,
                                'Content-Type': 'application/json',
                            },
                            timeout: 25000
                        }
                    );

                    if (fallbackResponse.data.answer) {
                        return fallbackResponse.data.answer;
                    }
                } catch (fallbackErr: any) {
                    console.error(' [Fallback Error]:', fallbackErr.response?.data || fallbackErr.message);
                }
            }
        }

        attempts++;
    }

    return 'حدث خطأ في الاتصال بالنظام، يرجى المحاولة لاحقاً.';
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
            if (!answer.startsWith('حدث خطأ')) {
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

    if (commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply();
        const answer = await sendQueryToDify(prompt, interaction.user.id);
        await interaction.editReply(answer);
    } 
    else if (commandName === 'dm') {
        const targetUser = interaction.options.getUser('target', true);
        const messageText = interaction.options.getString('message', true);

        try {
            await targetUser.send(messageText);
            await interaction.reply({ content: `✅ تم إرسال الرسالة إلى ${targetUser.tag} بنجاح!`, ephemeral: true });
        } catch (err) {
            await interaction.reply({ content: `❌ تعذر إرسال رسالة خاصة إلى ${targetUser.tag}.`, ephemeral: true });
        }
    }
    else if (commandName === 'chat-toggle') {
        const status = interaction.options.getString('status', true);
        isChatRespondingEnabled = (status === 'enable');
        await interaction.reply({
            content: `📢 تم **${isChatRespondingEnabled ? 'تفعيل 🟢' : 'إيقاف 🔴'}** ردود البوت التلقائية في الشات.`
        });
    }
    else if (commandName === 'mod') {
        const persona = interaction.options.getString('persona', true);
        isHumanPersona = (persona === 'human');
        await interaction.reply({
            content: `🎭 تم تغيير هُوية وشخصية البوت إلى: **${isHumanPersona ? '👤 إنسان حقيقي' : '🤖 بوت ذكاء اصطناعي'}**`
        });
    }
    else if (commandName === 'bot-mode') {
        const mode = interaction.options.getString('mode', true);
        isSavageModeEnabled = (mode === 'savage');
        await interaction.reply(`🤖 تم تغيير نمط البوت إلى: **${isSavageModeEnabled ? 'النمط الشرس وطقطقة (Savage Mode)' : 'النمط التقني الجاد واحترام الـ VIP (Technical Mode)'}**`);
    }
    else if (commandName === 'auto-topics') {
        const status = interaction.options.getString('status', true);
        isAutoTopicsEnabled = (status === 'enable');
        await interaction.reply(`تم ${isAutoTopicsEnabled ? 'تشغيل' : 'إيقاف'} المواضيع التلقائية.`);
    }
    else if (commandName === 'topic-now') {
        await interaction.reply({ content: 'جاري الإرسال...', ephemeral: true });
        await triggerRandomTopic(client);
    }
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
    else if (commandName === 'kick') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب مذكور';
        const member = await interaction.guild?.members.fetch(user.id);
        if (member) {
            await member.kick(reason);
            await interaction.reply({ content: `👞 تم طرد العضو ${user.tag} السبب: ${reason}` });
        }
    }
    else if (commandName === 'ban') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب مذكور';
        await interaction.guild?.members.ban(user.id, { reason });
        await interaction.reply({ content: `🔨 تم حظر العضو ${user.tag} السبب: ${reason}` });
    }
    else if (commandName === 'user-info') {
        const user = interaction.options.getUser('target') || interaction.user;
        await interaction.reply({
            content: `👤 **معلومات المستخدم:**\n• الاسم: **${user.tag}**\n• الـ ID: \`${user.id}\`\n• تاريخ إنشاء الحساب: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
        });
    }
    else if (commandName === 'server-info') {
        const guild = interaction.guild;
        if (!guild) return;
        await interaction.reply({
            content: `🏰 **معلومات السيرفر:**\n• اسم السيرفر: **${guild.name}**\n• إجمالي الأعضاء: **${guild.memberCount}**\n• المالك: <@${guild.ownerId}>`
        });
    }
});

// ==========================================
// 9. معالجة الرسائل والتحليل الذكي للشخصية والنمط
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        if (!isChatRespondingEnabled) return;

        // التحقق المباشر والصارم من الـ ID للـ VIP
        const envVipId = (process.env.VIP_USER_ID || '').trim();
        const envVipName = (process.env.VIP_USERNAME || '').trim().toLowerCase();

        const isVIP = (envVipId.length > 0 && message.author.id === envVipId) || 
                      (envVipName.length > 0 && message.author.username.toLowerCase() === envVipName);

        const contentLower = message.content.trim().toLowerCase();

        const mentionedVip = envVipId && message.mentions.users.has(envVipId);
        if (mentionedVip && !isVIP) {
            await message.reply('أبو حرب غير متفرغ حالياً.');
            return;
        }

        const isGreeting = ['السلام عليكم', 'سلام عليكم'].some(g => contentLower.includes(g));
        if (isGreeting) {
            await message.reply(isVIP ? 'وعليكم السلام يا أبو حرب، هلاً بك.' : 'وعليكم السلام.');
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

            let targetImageUrl: string | undefined = undefined;
            let imageTypeContext = '';

            if (message.stickers.size > 0) {
                const sticker = message.stickers.first();
                targetImageUrl = `https://media.discordapp.net/stickers/${sticker?.id}.png`;
                imageTypeContext = `[نوع المرفق: ستيكر دسكورد تعبيري بعنوان "${sticker?.name}"]`;
            }
            else if (message.attachments.size > 0) {
                const attachment = message.attachments.first();
                targetImageUrl = attachment?.url;
                const isGif = attachment?.contentType?.includes('gif') || attachment?.url.endsWith('.gif');
                imageTypeContext = isGif ? `[نوع المرفق: صورة متحركة GIF]` : `[نوع المرفق: صورة مرفقة بالشات]`;
            } 
            else if (cleanPrompt.includes('افتار') || cleanPrompt.includes('الافتار') || cleanPrompt.includes('صورة الحساب')) {
                const mentionedUser = message.mentions.users.first();
                const targetUser = mentionedUser || message.author;
                targetImageUrl = targetUser.displayAvatarURL({ extension: 'png", size: 512, forceStatic: true });
                imageTypeContext = `[نوع المرفق: أفتار (صورة البروفايل) للمستخدم ${targetUser.username}]`;
            }

            if (!cleanPrompt && !targetImageUrl) {
                await message.reply(isVIP ? 'سم يا أبو حرب، تحت أمرك.' : 'هلا بك.');
                return;
            }

            await message.channel.sendTyping();

            // --- جلب سجل المحادثة السابقة للتحليل الذكي ---
            let chatHistoryContext = "";
            try {
                const fetchedMessages = await message.channel.messages.fetch({ limit: 7 });
                const historyList = fetchedMessages
                    .reverse()
                    .filter(m => m.id !== message.id)
                    .map(m => `[${m.author.username}]: ${m.content}`)
                    .join("\n");

                if (historyList.trim().length > 0) {
                    chatHistoryContext = `[سجل المحادثة السابقة]:\n${historyList}\n---`;
                }
            } catch (err) {
                console.error("خطأ في جلب سجل المحادثة:", err);
            }

            const personaInstruction = isHumanPersona 
                ? 'تصرّف وتكلّم كأنك شخص حقيقي وعضو متفاعل في السيرفر. يمنع منعاً باتاً الاعتراف بكونك برنامج أو بوت.'
                : 'تصرّف وتكلّم بوضوح كأنك بوت ذكاء اصطناعي مساعد للسيرفر.';

            // تحديد سلوك الرد بأسلوب صارم جداً لمنع الطقطقة على الـ VIP
            let behaviorInstruction = '';
            
            if (!isSavageModeEnabled && isVIP) {
                // النمط تقني + المتحدث هو VIP (أبو حرب)
                behaviorInstruction = `
🚨 [أمر عالي الأهمية والسرية]:
المتحدث الحالي هو (أبو حرب) المالك والـ VIP.
النمط المفعل حالياً: (النمط التقني الجاد).
قوانين صارمة جداً:
1. يمنع منعاً باتاً الطقطقة، أو الاستهزاء، أو استخدام أي ألفاظ ساخرة أو غير محترمة نهائياً مع أبو حرب.
2. جاوبه بمنتهى الأدب، الوقار، والاحترام التقني.
3. قدّم له المساعدة فوراً بأسلوب جاد وواضح وبدون أي فلسفة أو طقطقة.
                `;
            } else if (!isSavageModeEnabled && !isVIP) {
                // النمط تقني + المتحدث عضو عادي
                behaviorInstruction = `
النمط المفعل: (تقني ولكن طقطقة على الاعضاء).
المتحدث عضو عادي. طقطق عليه واجلده بأسلوب ساخر وكوميدي.
                `;
            } else {
                // النمط الشرس (Savage Mode)
                behaviorInstruction = `
النمط المفعل: (شرس وطقطقة شاملة Savage Mode).
طقطق واجلد الجميع بلا استثناء بدون كلفة.
                `;
            }

            const strictInstructions = `
[القواعد والتعليمات]:
- الهوية: ${personaInstruction}
${behaviorInstruction}

- تحليل السياق:
1. تتبع المحادثة وافهم القصد.
2. ممنوع الوصف الجاف للصور إلا بطلب.
3. أجِب بدقة وبشكل مختصر ومباشر.
            `;

            const fullPrompt = `${strictInstructions}\n${chatHistoryContext}\n${imageTypeContext}\nالمستخدم الحالي (${message.author.username}): ${cleanPrompt || 'أرسل هذا المرفق كـ رد فعل'}`;

            const answer = await sendQueryToDify(fullPrompt, message.author.id, targetImageUrl);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
