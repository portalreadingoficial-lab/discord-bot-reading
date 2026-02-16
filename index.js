const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cors = require('cors');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const app = express();
app.use(cors());

// Render define a porta automaticamente
const PORT = process.env.PORT || 3000;
const GUILD_ID = '1458602213546135582';

// Rota de teste na raiz
app.get('/', (req, res) => {
    res.send('🚀 Bot Discord Online! Acesse /api/stats para ver os membros.');
});

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
        res.status(500).json({ error: 'Erro ao buscar dados' });
    }
});

// Token direto (por enquanto, para facilitar)
client.login(process.env.TOKEN);

app.listen(PORT, () => {
    console.log(`✅ Bot online na porta ${PORT}`);

});

