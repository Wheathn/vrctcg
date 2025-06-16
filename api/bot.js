const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const admin = require('firebase-admin');

// Initialize Firebase (reusing your setup)
let firebaseInitialized = false;
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : {};
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://vrctcg-default-rtdb.firebaseio.com/'
    }, 'discord-bot'); // Use a unique app name to avoid conflicts with your main app
    firebaseInitialized = true;
    console.log('Firebase initialized for Discord bot');
} catch (error) {
    console.error('Firebase initialization error for bot:', error.message);
}

const db = firebaseInitialized ? admin.database() : null;
const giftedRef = db ? db.ref('gifted') : null;

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = '1384143111839813773'; // Replace with your bot's client ID from Discord Developer Portal
const GUILD_ID = '1365149144628592740'; // Replace with your server's guild ID
const ADMIN_ROLE_ID = '1384139209169961071';

// Define Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('givepack')
        .setDescription('Give a pack to a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the pack to')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('packid')
                .setDescription('The ID of the pack: eg. svp, sv1, sv3, sv3p5, etc.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of packs (default: 1)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles), // Restrict to users with Manage Roles permission
    new SlashCommandBuilder()
        .setName('givepoints')
        .setDescription('Give points to a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give points to')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Amount of points to give')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
        .setName('checkgifts')
        .setDescription('Check all gifted data')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
].map(command => command.toJSON());

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error.message);
    }
})();

// Bot Event: Ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Bot Event: Interaction Create
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Check if user has the required role
    if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
    }

    if (!firebaseInitialized || !giftedRef) {
        await interaction.reply({ content: 'Database unavailable. Please try again later.', ephemeral: true });
        return;
    }

    try {
        if (interaction.commandName === 'givepack') {
            const user = interaction.options.getUser('user');
            const packid = interaction.options.getString('packid');
            const amount = interaction.options.getInteger('amount') || 1;

            if (amount < 1) {
                await interaction.reply({ content: 'Amount must be at least 1.', ephemeral: true });
                return;
            }

            const username = user.username;
            const packPath = `${username}/packs/${packid}`;
            await giftedRef.child(packPath).set(amount);
            console.log(`[givepack] Set ${packPath} to ${amount}`);
            await interaction.reply({ content: `Successfully gave ${amount} of pack ${packid} to ${username}.`, ephemeral: true });

        } else if (interaction.commandName === 'givepoints') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');

            if (amount < 0) {
                await interaction.reply({ content: 'Amount cannot be negative.', ephemeral: true });
                return;
            }

            const username = user.username;
            const currencyPath = `${username}/currency`;
            await giftedRef.child(currencyPath).set(amount);
            console.log(`[givepoints] Set ${currencyPath} to ${amount}`);
            await interaction.reply({ content: `Successfully gave ${amount} points to ${username}.`, ephemeral: true });

        } else if (interaction.commandName === 'checkgifts') {
            const snapshot = await giftedRef.once('value');
            const giftedData = snapshot.val() || {};
            const formattedData = JSON.stringify(giftedData, null, 2);
            // Discord has a 2000-character limit for messages, so we may need to truncate or send as a file
            if (formattedData.length > 1900) {
                const buffer = Buffer.from(formattedData, 'utf-8');
                await interaction.reply({
                    content: 'Gifted data is too large to display here. Sending as a file.',
                    files: [{ attachment: buffer, name: 'gifted_data.json' }],
                    ephemeral: true
                });
            } else {
                await interaction.reply({ content: `\`\`\`json\n${formattedData}\n\`\`\``, ephemeral: true });
            }
            console.log('[checkgifts] Returned gifted data');
        }
    } catch (error) {
        console.error(`Error handling command ${interaction.commandName}:`, error.message);
        await interaction.reply({ content: 'An error occurred while processing your command.', ephemeral: true });
    }
});

// Login to Discord
client.login(BOT_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error.message);
});