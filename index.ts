// @ts-nocheck
import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    TextChannel,
    GuildMember,
    MessageFlags
} from 'discord.js';
import { 
    joinVoiceChannel, 
    getVoiceConnection, 
    VoiceConnectionStatus, 
    entersState
} from '@discordjs/voice';
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
// 4. الثوابت والمعرفات الأساسية
// ==========================================
const token = process.env.DISCORD_BOT_TOKEN;
const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';

const TARGET_TEXT_CHANNEL_ID = '1459632620416532554'; 

const difyApiKeys = [
    process.env.DIFY_API_KEY1,
    process.env.DIFY_API_KEY2,
    process.env.DIFY_API_KEY3,
    process.env.DIFY_API_KEY4,
    process.env.DIFY_API_KEY5,
].filter((key): key is string => Boolean(key && key.trim().length > 0));

let currentKeyIndex = 0;
let isAutoTopicsEnabled = true; 
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
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ==========================================
// 5. تسجيل أوامر Slash والبدء
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
            .setName('room')
            .setDescription('التحكم بتواجد البوت في الروم الصوتي')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('ask')
                    .setDescription('اطرح سؤالاً، يدخل البوت رومك الصوتي ويجاوب ويبقى فيه')
                    .addStringOption(option =>
                        option.setName('prompt')
                            .setDescription('السؤال الذي تريد طرحه')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('exit')
                    .setDescription('إخراج البوت من الروم الصوتي')
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
            .setName('topic-now')
            .setDescription('طرح موضوع فوري في الشات المحدد'),
        new SlashCommandBuilder()
            .setName('purge')
            .setDescription('مسح عدد معين من الرسائل')
            .addIntegerOption(option => 
                option.setName('amount')
                    .setDescription('عدد الرسائل (1-100)')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands },
        );
        console.log('✅ تم تسجيل أوامر الـ Slash بنجاح!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    startPeriodicTask(readyClient);
});

// ==========================================
// 6. الاتصال بـ Dify
// ==========================================
async function sendQueryToDify(prompt: string, userId: string, imageUrl?: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    const files = imageUrl ? [{ type: 'image', transfer_method: 'remote_url', url: imageUrl }] : [];

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

            if (files.length > 0) payload.files = files;

            const response = await axios.post(
                `${difyBaseUrl}/chat-messages`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${keyToUse}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 60000
                }
            );

            let answer = response.data.answer;
            if (answer && answer.trim().length > 0) {
                const lines = answer.trim().split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 3 && !prompt.includes('برمجة')) {
                    answer = lines.slice(0, 3).join('\n');
                }
                return answer;
            }
        } catch (error: any) {
            console.error(` [Dify Error]:`, error.response?.data || error.message);
        }
        attempts++;
    }
    return 'حدث خطأ في الاتصال بالنظام، يرجى المحاولة لاحقاً.';
}

// ==========================================
// 7. المواضيع التلقائية (كل 12 ساعة)
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_TEXT_CHANNEL_ID);
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
    else if (commandName === 'room') {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'ask') {
            const prompt = interaction.options.getString('prompt', true);
            const member = interaction.member as GuildMember;
            const voiceChannel = member?.voice?.channel;

            if (!voiceChannel) {
                await interaction.reply({ content: '❌ يجب أن تكون متصلاً بروم صوتي أولاً لكي يدخل البوت إليك!', flags: MessageFlags.Ephemeral });
                return;
            }

            await interaction.deferReply();

            // الانضمام لروم المستخدم الصوتي
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            // التعامل مع أي انقطاع مفاجئ للاتصال بالروم
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    connection.destroy();
                }
            });

            const answer = await sendQueryToDify(prompt, interaction.user.id);
            await interaction.editReply(`🔊 **[تم الدخول إلى روم: ${voiceChannel.name}]**\n\n${answer}`);
        } 
        else if (subcommand === 'exit') {
            const connection = getVoiceConnection(interaction.guildId!);
            if (connection) {
                connection.destroy();
                await interaction.reply({ content: '👋 تم إخراج البوت من الروم الصوتي بنجاح.' });
            } else {
                await interaction.reply({ content: '❌ البوت ليس متصلاً بأي روم صوتي حالياً.', flags: MessageFlags.Ephemeral });
            }
        }
    }
    else if (commandName === 'chat-toggle') {
        const status = interaction.options.getString('status', true);
        isChatRespondingEnabled = (status === 'enable');
        await interaction.reply({ content: `📢 تم **${isChatRespondingEnabled ? 'تفعيل 🟢' : 'إيقاف 🔴'}** الردود.` });
    }
    else if (commandName === 'topic-now') {
        await interaction.reply({ content: 'جاري نشر الموضوع فوراً...', flags: MessageFlags.Ephemeral });
        await triggerRandomTopic(client);
    }
    else if (commandName === 'purge') {
        const amount = interaction.options.getInteger('amount', true);
        if (interaction.channel && 'bulkDelete' in interaction.channel) {
            await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: '🧹 تم مسح الرسائل بنجاح!', flags: MessageFlags.Ephemeral });
        }
    }
});

// ==========================================
// 9. معالجة الرسائل والرد في الشات المحدد
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;
        if (!isChatRespondingEnabled) return;

        const isTargetChannel = message.channelId === TARGET_TEXT_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            let cleanPrompt = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanPrompt = cleanPrompt.replace(mentionRegex, '').trim();
            }

            if (!cleanPrompt) return;

            await message.channel.sendTyping();
            const fullPrompt = `المرسل: ${message.author.username}\nنص الرسالة: ${cleanPrompt}`;
            const answer = await sendQueryToDify(fullPrompt, message.author.id);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
