const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

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
const GUILD_ID = '1458602213546135582';
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1472732287752732863';
const SITE_URL = 'https://portalreading.com'; // Substitua
const API_SITE_STATS = `${SITE_URL}/fazer_login/site_stats.php`;

// ========== CACHE INTELIGENTE ==========
let cachedStats = null;
let lastSuccessfulUpdate = 0;
let lastUpdateAttempt = 0;
let updateInProgress = false;
const CACHE_DURATION = 60000; // 60 segundos (mais estável)
const MAX_RETRY_AGE = 300000; // 5 minutos - se falhar, usa cache antigo

// Função melhorada para contar membros
function contarMembrosOnline(members) {
    let online = 0, idle = 0, dnd = 0, offline = 0;
    
    members.forEach(member => {
        if (member.user.bot) return; // Ignorar bots
        
        const status = member.presence?.status;
        
        if (status === 'online') online++;
        else if (status === 'idle') idle++;
        else if (status === 'dnd') dnd++;
        else offline++;
    });
    
    return { online, idle, dnd, offline };
}

// Função de atualização com retry inteligente
async function updateMemberCache(force = false) {
    const now = Date.now();
    
    // Evitar múltiplas atualizações simultâneas
    if (updateInProgress) {
        console.log('⏳ Atualização já em andamento...');
        return false;
    }
    
    // Se não for forçado e cache ainda é válido, não atualizar
    if (!force && cachedStats && (now - lastSuccessfulUpdate) < CACHE_DURATION) {
        return true;
    }
    
    // Evitar tentar atualizar muitas vezes se estiver falhando
    if (!force && (now - lastUpdateAttempt) < 10000) { // 10 segundos entre tentativas
        console.log('⏳ Muitas tentativas recentes, aguardando...');
        return false;
    }
    
    updateInProgress = true;
    lastUpdateAttempt = now;
    
    try {
        console.log('🔄 Atualizando cache de membros...');
        
        const guild = await client.guilds.fetch(GUILD_ID);
        
        // IMPORTANTE: Buscar membros com presenças
        await guild.members.fetch({ withPresences: true, force: true });
        
        const members = guild.members.cache;
        const humanos = members.filter(m => !m.user.bot);
        const counts = contarMembrosOnline(humanos);
        
        // Log detalhado
        console.log('📊 Status atual:');
        console.log(`   🟢 Online: ${counts.online}`);
        console.log(`   🌙 Ausente: ${counts.idle}`);
        console.log(`   ⛔ DND: ${counts.dnd}`);
        console.log(`   ⚫ Offline: ${counts.offline}`);
        console.log(`   🤖 Bots: ${members.filter(m => m.user.bot).size}`);
        
        // Criar novo cache
        cachedStats = {
            total: humanos.size,
            online: counts.online,
            idle: counts.idle,
            dnd: counts.dnd,
            offline: counts.offline,
            bots: members.filter(m => m.user.bot).size,
            humanos: humanos.size,
            membrosOnline: humanos
                .filter(m => m.presence?.status === 'online')
                .map(m => ({
                    nome: m.user.username,
                    apelido: m.nickname || m.user.username
                }))
                .slice(0, 15),
            lastUpdate: now,
            cacheAge: 'atualizado'
        };
        
        lastSuccessfulUpdate = now;
        console.log(`✅ Cache atualizado com sucesso! (${counts.online} online)`);
        return true;
        
    } catch (error) {
        console.error('❌ Erro na atualização:', error.message);
        
        // Se tem cache antigo, manter ele
        if (cachedStats) {
            cachedStats.cacheAge = 'cache antigo (falha na atualização)';
            console.log('⚠️ Usando cache antigo devido a erro');
        }
        
        // Se for rate limit, agendar retry
        if (error.message.includes('rate limited')) {
            const retryAfter = error.data?.retry_after || 30;
            console.log(`⏳ Rate limit. Agendando retry em ${retryAfter}s`);
            setTimeout(() => updateMemberCache(true), retryAfter * 1000);
        }
        
        return false;
    } finally {
        updateInProgress = false;
    }
}

// Quando o bot estiver pronto
client.once('ready', async () => {
    console.log(`✅ Bot ${client.user.tag} está online!`);
    
    // Atualização inicial
    await updateMemberCache(true);
    
    // Atualizar a cada 60 segundos
    setInterval(async () => {
        console.log('⏰ Executando atualização periódica...');
        await updateMemberCache(false);
    }, CACHE_DURATION);
    
    // Evento de mudança de presença
    client.on('presenceUpdate', async (oldPresence, newPresence) => {
        // Se o cache tem mais de 30 segundos, atualizar
        if (Date.now() - lastSuccessfulUpdate > 30000) {
            console.log('🔄 Presença alterada, atualizando cache...');
            updateMemberCache(false);
        }
    });
});

// ========== ROTA DA API ==========
app.get('/api/stats', async (req, res) => {
    try {
        const now = Date.now();
        
        // Se não tem cache, tentar atualizar
        if (!cachedStats) {
            console.log('📡 Cache vazio, atualizando...');
            await updateMemberCache(true);
            
            if (!cachedStats) {
                return res.status(503).json({ 
                    error: 'Serviço indisponível',
                    online: 0,
                    message: 'Aguardando primeira atualização'
                });
            }
        }
        
        // Se cache está velho, tentar atualizar em background
        if ((now - lastSuccessfulUpdate) > CACHE_DURATION) {
            console.log('📡 Cache expirado, atualizando em background...');
            updateMemberCache(false); // Não aguardar
        }
        
        // Se cache está MUITO velho (mais de 5 min), avisar
        const cacheAge = Math.floor((now - lastSuccessfulUpdate) / 1000);
        const responseData = {
            ...cachedStats,
            cacheAge: cacheAge + 's',
            fresh: cacheAge < 60
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Erro na API:', error);
        
        // Se tiver cache, retornar ele mesmo com erro
        if (cachedStats) {
            res.json({
                ...cachedStats,
                error: 'Usando cache devido a erro',
                online: cachedStats.online
            });
        } else {
            res.status(500).json({ 
                error: 'Erro interno',
                online: 0 
            });
        }
    }
});

// ========== ROTA DE DEBUG (opcional) ==========
app.get('/api/debug', (req, res) => {
    res.json({
        hasCache: !!cachedStats,
        lastUpdate: lastSuccessfulUpdate ? new Date(lastSuccessfulUpdate).toISOString() : null,
        lastAttempt: lastUpdateAttempt ? new Date(lastUpdateAttempt).toISOString() : null,
        cacheAge: lastSuccessfulUpdate ? Math.floor((Date.now() - lastSuccessfulUpdate) / 1000) + 's' : null,
        updateInProgress,
        stats: cachedStats
    });
});

// ========== COMANDOS SLASH ==========
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Mostra quantos usuários estão online no site Reading')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands.map(command => command.toJSON()) }
        );
        console.log('✅ Comandos slash registrados!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();

// ========== INTERAÇÕES ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'status') {
        await interaction.deferReply();
        
        try {
            const response = await fetch(API_SITE_STATS, { timeout: 5000 });
            const data = await response.json();
            
            const onlineCount = data.online || 0;
            const totalCount = data.total || 0;
            
            let statusEmoji = '🔴';
            if (onlineCount > 10) statusEmoji = '🟢';
            else if (onlineCount > 0) statusEmoji = '🟡';
            
            const embed = {
                color: 0x83d3f3,
                title: '📊 Reading Status',
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
                timestamp: new Date().toISOString()
            };
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Erro no comando status:', error);
            await interaction.editReply({
                content: '❌ Erro ao buscar status do site.',
                ephemeral: true
            });
        }
    }
});

client.login(TOKEN);

app.listen(PORT, () => {
    console.log(`📡 API rodando na porta ${PORT}`);
    console.log(`🔍 Debug disponível em /api/debug`);
});
