const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Instale com: npm install node-fetch@2

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const GUILD_ID = '1458602213546135582'; // Seu servidor
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1472732287752732863'; // Pegue no Discord Developer Portal > General Information

// URL do seu site (ajuste conforme necessário)
const SITE_URL = 'https://seudominio.com'; // Altere para a URL do seu site
const API_SITE_STATS = `${SITE_URL}/api/site_stats.php`; // Vamos criar este endpoint

// ========== REGISTRAR COMANDOS SLASH ==========
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Mostra quantos usuários estão online no site Reading')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('🔄 Registrando comandos slash...');
        
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands.map(command => command.toJSON()) }
        );
        
        console.log('✅ Comandos slash registrados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();

// ========== EVENTO DE INTERAÇÃO (SLASH COMMANDS) ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'status') {
        await interaction.deferReply(); // Resposta demorada
        
        try {
            // Buscar estatísticas do site
            const response = await fetch(API_SITE_STATS, {
                timeout: 5000 // 5 segundos de timeout
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Formatar resposta
            const onlineCount = data.online || 0;
            const totalCount = data.total || 0;
            
            // Definir emoji baseado no número de online
            let statusEmoji = '🔴';
            if (onlineCount > 10) statusEmoji = '🟢';
            else if (onlineCount > 0) statusEmoji = '🟡';
            
            // Criar embed bonito
            const embed = {
                color: 0x83d3f3, // Cor azul do seu site
                title: '📊 Reading Status',
                thumbnail: {
                    url: 'https://cdn.discordapp.com/attachments/.../logo.png' // Opcional: logo do seu site
                },
                fields: [
                    {
                        name: '👥 Usuários Online',
                        value: `${statusEmoji} **${onlineCount}** usuário${onlineCount !== 1 ? 's' : ''}`,
                        inline: true
                    },
                    {
                        name: '📈 Total de Usuários',
                        value: `👤 **${totalCount}** usuário${totalCount !== 1 ? 's' : ''}`,
                        inline: true
                    },
                    {
                        name: '🕒 Última atualização',
                        value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                        inline: false
                    }
                ],
                footer: {
                    text: 'Reading Community',
                    icon_url: 'https://cdn.discordapp.com/attachments/.../footer-icon.png'
                },
                timestamp: new Date().toISOString()
            };
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Erro ao buscar status do site:', error);
            await interaction.editReply({
                content: '❌ Erro ao buscar informações do site. Tente novamente mais tarde.',
                ephemeral: true
            });
        }
    }
});

// ========== ROTA DO BOT (JÁ EXISTENTE) ==========
app.get('/api/stats', async (req, res) => {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.members.fetch();
        
        const members = guild.members.cache;
        
        const stats = {
            total: members.size,
            online: members.filter(m => m.presence?.status === 'online').size,
            idle: members.filter(m => m.presence?.status === 'idle').size,
            dnd: members.filter(m => m.presence?.status === 'dnd').size,
            offline: members.filter(m => !m.presence || m.presence?.status === 'offline').size,
            bots: members.filter(m => m.user.bot).size,
            humanos: members.filter(m => !m.user.bot).size,
            membrosOnline: members
                .filter(m => m.presence?.status === 'online' && !m.user.bot)
                .map(m => ({
                    nome: m.user.username,
                    apelido: m.nickname || m.user.username
                }))
                .slice(0, 10)
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar dados' });
    }
});

client.login(TOKEN);

app.listen(PORT, () => {
    console.log(`📡 API rodando na porta ${PORT}`);
});
