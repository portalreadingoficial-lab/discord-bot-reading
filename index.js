const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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

// ========== CONFIGURAÇÕES (via variáveis de ambiente do host) ==========
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1458602213546135582';
const TOKEN = process.env.DISCORD_TOKEN; // JÁ ESTÁ NO HOST
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1472732287752732863';
const SITE_URL = 'https://portalreading.com';
const API_URL = `${SITE_URL}/api_mangas.php`;
const API_SITE_STATS = `${SITE_URL}/fazer_login/site_stats.php`;
const BANNER_URL = `${SITE_URL}/bannersdiscord/ipsite.jpg`;

// Verificação
if (!TOKEN) {
    console.error('❌ ERRO: Token não encontrado nas variáveis de ambiente!');
    process.exit(1);
}

console.log('✅ Bot iniciando...');
console.log(`📌 Servidor ID: ${GUILD_ID}`);
console.log(`📌 Client ID: ${CLIENT_ID}`);

// Cache
let mangaCache = { data: null, timestamp: 0 };
let titlesCache = { data: [], timestamp: 0 };
let statsCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 300000; // 5 minutos

// ========== FUNÇÕES DE API ==========
async function fetchFromAPI(endpoint, params = '') {
    try {
        const response = await fetch(`${API_URL}?acao=${endpoint}${params}`, { timeout: 5000 });
        const data = await response.json();
        return data.success ? data.data : null;
    } catch (error) {
        console.error(`Erro na API (${endpoint}):`, error.message);
        return null;
    }
}

async function getAllMangas() {
    const now = Date.now();
    
    if (mangaCache.data && (now - mangaCache.timestamp) < CACHE_DURATION) {
        return mangaCache.data;
    }
    
    const data = await fetchFromAPI('lista');
    if (data) {
        const mangas = data.map(manga => ({
            id: manga.id,
            titulo: manga.titulo,
            tituloLower: manga.titulo.toLowerCase(),
            ano: manga.ano || 'N/A',
            tipo: manga.tipo || 'N/A',
            status: manga.status || 'N/A',
            capa: formatCapaUrl(manga.capa),
            link: `${SITE_URL}/fazer_login/detalhes.php?id=${manga.id}`
        }));
        
        mangaCache = { data: mangas, timestamp: now };
        return mangas;
    }
    
    return mangaCache.data || [];
}

async function getMangaTitles() {
    const now = Date.now();
    
    if (titlesCache.data.length > 0 && (now - titlesCache.timestamp) < CACHE_DURATION) {
        return titlesCache.data;
    }
    
    const data = await fetchFromAPI('titulos');
    if (data) {
        titlesCache = { data, timestamp: now };
        return data;
    }
    
    return titlesCache.data;
}

async function getMangaByName(nome) {
    try {
        const response = await fetch(`${API_URL}?acao=busca&nome=${encodeURIComponent(nome)}`, { timeout: 5000 });
        const result = await response.json();
        
        if (!result.success || !result.data) return null;
        
        const manga = result.data;
        
        let generos = [];
        if (manga.subtitulo) {
            generos = manga.subtitulo.split(',').map(g => g.trim()).filter(g => g);
        }
        
        return {
            id: manga.id,
            titulo: manga.titulo,
            ano: manga.ano || 'N/A',
            tipo: manga.tipo || 'N/A',
            status: manga.status || 'N/A',
            generos: generos,
            capa: formatCapaUrl(manga.capa),
            link: `${SITE_URL}/fazer_login/detalhes.php?id=${manga.id}`
        };
    } catch (error) {
        console.error('Erro na busca:', error.message);
        return null;
    }
}

function formatCapaUrl(capaPath) {
    if (!capaPath) return 'https://via.placeholder.com/300x450/333/fff?text=Sem+Capa';
    if (capaPath.startsWith('http')) return capaPath;
    if (capaPath.includes('../capas/')) {
        return capaPath.replace('../', `${SITE_URL}/`);
    }
    if (!capaPath.startsWith('/')) {
        return `${SITE_URL}/capas/${capaPath}`;
    }
    return `${SITE_URL}${capaPath}`;
}

// ========== FUNÇÕES DE MEMBROS ==========
let cachedStats = null;
let lastUpdate = 0;
const MEMBER_CACHE_DURATION = 60000;

async function updateMemberCache() {
    const now = Date.now();
    if (cachedStats && (now - lastUpdate) < MEMBER_CACHE_DURATION) return;
    
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.members.fetch({ withPresences: true });
        
        const members = guild.members.cache;
        const humanos = members.filter(m => !m.user.bot);
        
        let online = 0, idle = 0, dnd = 0;
        humanos.forEach(m => {
            const status = m.presence?.status;
            if (status === 'online') online++;
            else if (status === 'idle') idle++;
            else if (status === 'dnd') dnd++;
        });
        
        cachedStats = {
            total: humanos.size,
            online,
            idle,
            dnd,
            offline: humanos.size - online - idle - dnd
        };
        
        lastUpdate = now;
        console.log(`✅ Membros atualizados: ${online} online`);
    } catch (error) {
        console.error('Erro update members:', error.message);
    }
}

// ========== COMANDOS ==========
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Mostra quantos usuários estão online no site Reading'),
    
    new SlashCommandBuilder()
        .setName('mangas')
        .setDescription('Mostra lista completa de mangás disponíveis (Cooldown: 5min)'),
    
    new SlashCommandBuilder()
        .setName('manga')
        .setDescription('Busca informações de um mangá específico')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do mangá')
                .setRequired(true)
                .setAutocomplete(true)),
    
    new SlashCommandBuilder()
        .setName('site')
        .setDescription('Informações sobre o site Reading')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ========== COOLDOWNS ==========
const cooldowns = new Map();
const MANGAS_COOLDOWN = 300000; // 5 minutos

// ========== EVENTOS ==========
client.once('ready', async () => {
    console.log(`✅ Bot ${client.user.tag} online!`);
    
    await updateMemberCache();
    
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Comandos registrados!');
    } catch (error) {
        console.error('Erro registrando comandos:', error);
    }
    
    setInterval(updateMemberCache, MEMBER_CACHE_DURATION);
});

// AutoComplete
client.on('interactionCreate', async interaction => {
    if (!interaction.isAutocomplete()) return;
    
    if (interaction.commandName === 'manga') {
        const focused = interaction.options.getFocused().toLowerCase();
        const titles = await getMangaTitles();
        
        const filtered = titles
            .filter(t => t.toLowerCase().includes(focused))
            .slice(0, 25);
        
        await interaction.respond(filtered.map(t => ({ name: t, value: t })));
    }
});

// Comandos
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    await interaction.deferReply({ ephemeral: true });
    
    // /status
    if (interaction.commandName === 'status') {
        try {
            const response = await fetch(API_SITE_STATS, { timeout: 5000 });
            const data = await response.json();
            
            const embed = new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle('📊 Reading Status')
                .addFields(
                    { name: '👥 Online', value: `**${data.online || 0}**`, inline: true },
                    { name: '📈 Total', value: `**${data.total || 0}**`, inline: true }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        } catch {
            await interaction.editReply('❌ Erro ao buscar status');
        }
    }
    
    // /mangas
    if (interaction.commandName === 'mangas') {
        if (!interaction.member.permissions.has('Administrator')) {
            const cooldown = cooldowns.get(interaction.user.id);
            if (cooldown && Date.now() - cooldown < MANGAS_COOLDOWN) {
                const minutes = Math.ceil((MANGAS_COOLDOWN - (Date.now() - cooldown)) / 60000);
                return interaction.editReply(`⏳ Aguarde ${minutes} minuto(s)`);
            }
        }
        
        const mangas = await getAllMangas();
        
        if (!mangas.length) {
            return interaction.editReply('❌ Nenhum mangá encontrado');
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x83d3f3)
            .setTitle('📚 Biblioteca Reading')
            .setDescription(`Total: **${mangas.length}** mangás`)
            .addFields({
                name: '📖 Destaques',
                value: mangas.slice(0, 10).map((m, i) => 
                    `${i+1}. **${m.titulo}** (${m.ano})`
                ).join('\n')
            });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🔍 Ver todos')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
            );
        
        await interaction.editReply({ embeds: [embed], components: [row] });
        cooldowns.set(interaction.user.id, Date.now());
    }
    
    // /manga
    if (interaction.commandName === 'manga') {
        const nome = interaction.options.getString('nome');
        const manga = await getMangaByName(nome);
        
        if (!manga) {
            return interaction.editReply(`❌ Mangá "${nome}" não encontrado`);
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x83d3f3)
            .setTitle(manga.titulo)
            .setThumbnail(manga.capa)
            .addFields(
                { name: '📅 Ano', value: manga.ano, inline: true },
                { name: '📖 Tipo', value: manga.tipo, inline: true },
                { name: '📊 Status', value: manga.status, inline: true },
                { name: '🏷️ Gêneros', value: manga.generos.join(', ') || 'N/A' }
            );
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('📖 Ler Mangá')
                    .setStyle(ButtonStyle.Link)
                    .setURL(manga.link)
            );
        
        await interaction.editReply({ embeds: [embed], components: [row] });
    }
    
    // /site
    if (interaction.commandName === 'site') {
        try {
            const stats = await fetch(API_SITE_STATS).then(r => r.json()).catch(() => ({}));
            
            const embed = new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle('🌐 Reading')
                .setDescription('Leia mangás online, gratuitamente!')
                .setImage(BANNER_URL)
                .addFields(
                    { name: '👥 Online', value: `**${stats.online || 0}**`, inline: true },
                    { name: '📚 Total', value: `**${stats.total || 0}**`, inline: true }
                );
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🚀 Acessar')
                        .setStyle(ButtonStyle.Link)
                        .setURL(SITE_URL)
                );
            
            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch {
            const embed = new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle('🌐 Reading')
                .setImage(BANNER_URL);
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🚀 Acessar')
                        .setStyle(ButtonStyle.Link)
                        .setURL(SITE_URL)
                );
            
            await interaction.editReply({ embeds: [embed], components: [row] });
        }
    }
});

// ========== ROTA DE SAÚDE ==========
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ========== INICIAR ==========
client.login(TOKEN);

app.listen(PORT, () => {
    console.log(`📡 API rodando na porta ${PORT}`);
});

process.on('unhandledRejection', error => {
    console.error('Erro não tratado:', error.message);
});
