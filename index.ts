import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// 1. إعداد سيرفر وهمي لفتح الـ Port لـ Render
const PORT = process.env.PORT || 3000;
http.createServer((_, res) => {
    res.write('Bot is alive!');
    res.end();
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// 2. كود الـ Self-Ping لمنع Render من وضع الخمول (Sleep)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot22-8aow.onrender.com';

setInterval(() => {
    http.get(RENDER_URL, (res) => {
        console.log(`Self-ping status code: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Self-ping failed:', err.message);
    });
}, 10 * 60 * 1000); // إرسال طلب كل 10 دقائق

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
        GatewayIntentBits.MessageContent,
    ],
});

// استخدام الحدث الجاهز مع ميزة حماية الأخطاء
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
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
        
        // التفاعل مع المستخدم فوراً لتجنب خطأ الـ 3 ثواني من ديسكورد
        await interaction.deferReply();

        try {
            const response = await axios.post(
                `${difyBaseUrl}/chat-messages`,
                {
                    inputs: {},
                    query: prompt,
                    response_mode: 'blocking',
                    user: interaction.user.id,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${difyApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 25000 // المهلة القصوى لانتظار Dify (25 ثانية)
                }
            );

            const answer = response.data.answer || 'No response received from Dify.';
            
            // التعامل مع الأجوبة الطويلة
            if (answer.length > 2000) {
                await interaction.editReply(answer.substring(0, 1990) + '...\n*(الرد مقصوص لكبر الحجم)*');
            } else {
                await interaction.editReply(answer);
            }
        } catch (error: any) {
            console.error('Dify API Error:', error.response?.data || error.message);
            await interaction.editReply('Sorry, an error occurred while communicating with the AI.');
        }
    }
});

client.login(token);
