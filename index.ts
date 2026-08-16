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
    res.write('Red John Bot is Online & Hunting!');
    res.end();
}).listen(PORT, () => {
    console.log(` [Server] Listening on port ${PORT}`);
});

// ==========================================
// 3. نظام Keep-Alive
// ==========================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';
setInterval(async () => {
    try {
        await axios.get(RENDER_URL, { timeout: 10000 });
    } catch (err: any) {
        console.error(' [Keep-Alive] Ping fail:', err.message);
    }
}, 8 * 60 * 1000);

// ==========================================
// 4. الثوابت والمفاتيح
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
    ],
});

// ==========================================
// 5. توجيه الشخصية: Red John + تقني + فلاوي + جلد بدون رحمة
// ==========================================
const RED_JOHN_SYSTEM_PROMPT = `[توجيه الشخصية الصارم]:
أنت الآن بشخصية "ريد جون (Red John)" من مسلسل The Mentalist، ولكن بنسخة هكر وتقني سعودي فلاوي وطقطاق 100%!
قواعدك الصارمة جداً:
1. ممنوع نهائياً أن تكون طبيعياً أو رسمياً أو مؤدباً (نسبة الطبيعية عندك 0%)!
2. اجلد وطقطق على الجميع بدون رحمة ولا رأفة ولا احترام لأي أحد!
3. ادخل مصطلحات تقنية وهكر وسيرفرات بأسلوب ساخر وفلاوي (مثل: "مخك يحتاج Format"، "سيرفرك ضارب"، "أنت عبارة عن Bug"، "DDoS على رأسك"، "Packet loss في استيعابك").
4. اظهر بمظهر الشخص العباقرة اللي دائماً سابق الكل بخطوة مثل Red John، بس بأسلوب ذبات وطقطقة شوارع وفلاوية.
5. إذا تم إرفاق افتار أو صورة أو GIF أو استيكر، احلب الصورة جلد وطقطقة كـ "ذبة" ولا تشرح الصورة إطلاقاً!
6. اقرأ سياق آخر الرسائل السابقة واجلد صاحب الرسالة بناءً على السالفة اللي قالها.`;

async function sendQueryToDify(prompt: string, userId: string, imageUrl?: string): Promise<string> {
    const totalKeys = difyApiKeys.length;
    let attempts = 0;

    const files = imageUrl ? [{ type: 'image', transfer_method: 'remote_url', url: imageUrl }] : [];
    const finalPrompt = `${RED_JOHN_SYSTEM_PROMPT}\n\n${prompt}`;

    while (attempts < totalKeys) {
        const keyToUse = difyApiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            const payload: any = {
                inputs: {},
                query: finalPrompt,
                response_mode: 'blocking',
                user: userId,
            };

            if (files.length > 0) payload.files = files;

            const response = await axios.post(`${difyBaseUrl}/chat-messages`, payload, {
                headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' },
                timeout: 60000
            });

            let answer = response.data.answer;
            if (answer && answer.trim().length > 0) {
                return answer.trim();
            }
        } catch (error: any) {
            console.error(` [Dify Error]:`, error.response?.data || error.message);
        }
        attempts++;
    }
    return 'سيرفراتك ضاربة يا حلو، جرب مرة ثانية لاني قاعد اسوي عليك Scan..';
}

// ==========================================
// 6. تسجيل البوت وتجهيز الأوامر
// ==========================================
client.once('ready', async (readyClient) => {
    console.log(` Red John Bot is Ready as ${readyClient.user.tag}!`);

    startPeriodicTask(readyClient);
});

// ==========================================
// 7. المواضيع التلقائية الساخرة (كل 12 ساعة)
// ==========================================
async function triggerRandomTopic(botClient: Client) {
    try {
        const channel = await botClient.channels.fetch(TARGET_TEXT_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const randomPrompt = `اطرح سؤالاً أو موضوعاً شاطحاً جداً وطقطقة في سطر واحد يجلد الأعضاء بأسلوب Red John التقني. ممنوع المقدمات الرسمية.`;
            const answer = await sendQueryToDify(randomPrompt, 'cron_12h_system');
            if (!answer.startsWith('سيرفراتك')) {
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
// 8. المحرك الرئيسي: الاستجابة للشات + تحليل آخر 5 رسائل + سحب الافتارات تلقائياً
// ==========================================
client.on('messageCreate', async message => {
    try {
        if (message.author.bot || !isChatRespondingEnabled) return;

        const isTargetChannel = message.channelId === TARGET_TEXT_CHANNEL_ID;
        const isBotMentioned = client.user && message.mentions.has(client.user);

        if (isTargetChannel || isBotMentioned) {
            await message.channel.sendTyping();

            // 1. جلب وتحليل آخر 5 رسائل من الشات لمعرفة السياق قبل الرد
            let chatHistoryContext = '';
            try {
                const fetchedMessages = await message.channel.messages.fetch({ limit: 6 }); // جلب الرسالة الحالية + 5 سابقات
                const last5 = Array.from(fetchedMessages.values())
                    .filter(m => m.id !== message.id) // استبعاد الرسالة الحالية
                    .reverse()
                    .slice(-5)
                    .map(m => `${m.author.username}: ${m.content}`)
                    .join('\n');

                if (last5) {
                    chatHistoryContext = `[آخر 5 رسائل في الشات للفهم والسياق]:\n${last5}\n---`;
                }
            } catch (err) {
                console.error('فشل في جلب تاريخ الرسائل:', err);
            }

            // 2. فحص الافتارات للمنشن تلقائياً
            let targetAvatarUrl: string | undefined = undefined;
            let mentionDetails = '';

            if (message.mentions.users.size > 0) {
                // البحث عن أول شخص ممنشن (وليس البوت نفسه)
                const mentionedUser = message.mentions.users.find(u => u.id !== client.user?.id);
                if (mentionedUser) {
                    targetAvatarUrl = mentionedUser.displayAvatarURL({ extension: 'png', size: 512 });
                    mentionDetails = `[ملاحظة: المنسل/المستهدف هو ${mentionedUser.username} وافتاره مرفق لك لتطقطق وتجلد افتاره كـ ذبة!]`;
                }
            }

            // 3. فحص الاستيكرات، الصور، والـ GIFs
            let mediaUrl = targetAvatarUrl; // الافتار له الأولوية إذا تم المنشن
            let mediaNotice = mentionDetails;

            if (!mediaUrl && message.stickers.size > 0) {
                const sticker = message.stickers.first();
                if (sticker) {
                    mediaUrl = sticker.url;
                    mediaNotice = `[الرسالة تحتوي على استيكر: ${sticker.name} - اجلد الذبة!]`;
                }
            }

            if (!mediaUrl && message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment) {
                    mediaUrl = attachment.url;
                    mediaNotice = `[الرسالة تحتوي صورة/مرفق - اجلد الذبة!]`;
                }
            }

            if (!mediaUrl) {
                const tenorRegex = /(https?:\/\/(?:www\.)?(?:tenor\.com|giphy\.com)\/\S+)/i;
                const match = message.content.match(tenorRegex);
                if (match) {
                    mediaUrl = match[0];
                    mediaNotice = `[الرسالة تحتوي GIF - اجلد الذبة!]`;
                }
            }

            // 4. تجهيز النص الكامل الموجه للذكاء الاصطناعي
            let cleanText = message.content;
            if (client.user) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                cleanText = cleanText.replace(mentionRegex, '').trim();
            }

            const promptToSend = `${chatHistoryContext}\nالكاتب الحالي: ${message.author.username}\nكلام الكاتب: "${cleanText}"\n${mediaNotice}`;

            // 5. إرسال الطلب وإصدار الرد الساخر
            const answer = await sendQueryToDify(promptToSend, message.author.id, mediaUrl);
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Error handling messageCreate:', error);
    }
});

client.login(token);
