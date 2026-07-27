import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// إعداد سيرفر وهمي لفتح الـ Port ومنع Render من إيقاف البوت
const PORT = process.env.PORT || 3000;
http.createServer((_, res) => {
    res.write('Bot is alive!');
    res.end();
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag}!`);

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
            Routes.applicationCommands(client.user!.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ask') {
        const prompt = interaction.options.getString('prompt', true);
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
                }
            );

            const answer = response.data.answer || 'No response received from Dify.';
            if (answer.length > 2000) {
                await interaction.editReply(answer.substring(0, 2000));
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
