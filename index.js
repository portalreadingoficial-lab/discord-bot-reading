const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType } = require('discord.js');
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

// ========== CONFIGURAÇÕES ==========
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1458602213546135582';
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1472732287752732863';
const SITE_URL = 'https://portalreading.com';
const API_URL = `${SITE_URL}/fazer_login/api_mangas.php`;
const API_SITE_STATS = `${SITE_URL}/fazer_login/site_stats.php`;
const BANNER_URL = `${SITE_URL}/bannersdiscord/ipsite.jpg`;

if (!TOKEN) {
    console.error('❌ ERRO: Token não encontrado!');
    process.exit(1);
}

// ========== CACHES ==========
let mangaCache = { data: null, timestamp: 0 };
let titulosCache = { data: [], timestamp: 0 };
const CACHE_DURATION = 300000; // 5 minutos
const CACHE_TITULOS_DURATION = 60000; // 1 minuto

// Cache de membros
let cachedStats = null;
let lastUpdate = 0;
const MEMBER_CACHE_DURATION = 60000;

// Cooldowns
const cooldowns = new Map();
const MANGAS_COOLDOWN = 300000; // 5 minutos

// ========== FUNÇÕES DE API ==========
async function fetchFromAPI(endpoint, params = '') {
    try {
        const response = await fetch(`${API_URL}?acao=${endpoint}${params}`, { 
            timeout: 5000 
        });
        const data = await response.json();
        return data.success ? data.data : null;
    } catch (error) {
        console.error(`Erro na API (${endpoint}):`, error.message);
        return null;
    }
}

async function getMangaTitles() {
    const agora = Date.now();
    
    if (titulosCache.data.length > 0 && 
        (agora - titulosCache.timestamp) < CACHE_TITULOS_DURATION) {
        return titulosCache.data;
    }
    
    try {
        const data = await fetchFromAPI('titulos');
        if (data) {
            titulosCache = { data, timestamp: agora };
            return data;
        }
        return titulosCache.data || [];
    } catch (error) {
        return titulosCache.data || [];
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

async function getMangaByName(nome) {
    try {
        const response = await fetch(`${API_URL}?acao=busca&nome=${encodeURIComponent(nome)}`, { 
            timeout: 5000 
        });
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
    } catch (error) {}
}

// ========== FUNÇÃO PARA CRIAR GRID DE MANGÁS ==========
function criarGridMangas(mangas, pagina = 0, itensPorPagina = 9) {
    const start = pagina * itensPorPagina;
    const end = start + itensPorPagina;
    const paginaMangas = mangas.slice(start, end);
    const totalPaginas = Math.ceil(mangas.length / itensPorPagina);
    
    // Criar descrição com os mangás em formato de grid
    let descricao = '';
    paginaMangas.forEach((manga, index) => {
        const numero = start + index + 1;
        descricao += `**${numero}.** [${manga.titulo}](${manga.link}) ─ ${manga.ano} • ${manga.tipo}\n`;
    });
    
    // Criar embed com thumbnail da primeira capa da página
    const embed = new EmbedBuilder()
        .setColor(0x83d3f3)
        .setTitle('📚 Biblioteca Reading')
        .setDescription(descricao)
        .addFields(
            { name: '📊 Total', value: `**${mangas.length}** mangás`, inline: true },
            { name: '📄 Página', value: `**${pagina + 1}/${totalPaginas}**`, inline: true }
        )
        .setFooter({ text: 'Clique nos botões para navegar' })
        .setTimestamp();
    
    // Adicionar thumbnail da primeira capa da página (se houver)
    if (paginaMangas.length > 0 && paginaMangas[0].capa) {
        embed.setThumbnail(paginaMangas[0].capa);
    }
    
    return { embed, totalPaginas };
}

// ========== COMANDOS SLASH ==========
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

// ========== EVENTO READY ==========
client.once('ready', async () => {
    console.log(`✅ Bot ${client.user.tag} online!`);
    console.log(`📌 Servidor ID: ${GUILD_ID}`);
    
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

// ========== AUTOCOMPLETE ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isAutocomplete()) return;
    
    if (interaction.commandName === 'manga') {
        try {
            const focused = interaction.options.getFocused().toLowerCase();
            
            const titles = await Promise.race([
                getMangaTitles(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 2000)
                )
            ]);
            
            if (!titles || titles.length === 0) {
                return await interaction.respond([]).catch(() => {});
            }
            
            const filtered = titles
                .filter(t => t && t.toLowerCase().includes(focused))
                .slice(0, 25);
            
            await interaction.respond(
                filtered.map(t => ({ 
                    name: t.substring(0, 100), 
                    value: t.substring(0, 100) 
                }))
            ).catch(() => {});
            
        } catch (error) {
            try { await interaction.respond([]); } catch (e) {}
        }
    }
});

// ========== COMANDOS ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    await interaction.deferReply({ ephemeral: true });
    
    // ===== /status =====
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
    
    // ===== /mangas com grid e navegação =====
    if (interaction.commandName === 'mangas') {
        // Cooldown
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
        
        let paginaAtual = 0;
        const { embed, totalPaginas } = criarGridMangas(mangas, paginaAtual);
        
        // Criar botões de navegação
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('primeira')
                    .setLabel('⏪')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(paginaAtual === 0),
                new ButtonBuilder()
                    .setCustomId('anterior')
                    .setLabel('◀')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(paginaAtual === 0),
                new ButtonBuilder()
                    .setCustomId('proxima')
                    .setLabel('▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(paginaAtual === totalPaginas - 1),
                new ButtonBuilder()
                    .setCustomId('ultima')
                    .setLabel('⏩')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(paginaAtual === totalPaginas - 1),
                new ButtonBuilder()
                    .setCustomId('ver_todos')
                    .setLabel('🔍 Ver no Site')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
            );
        
        const response = await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
        
        // Criar coletor para os botões
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000 // 5 minutos
        });
        
        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ 
                    content: '❌ Você não pode usar esses botões.', 
                    ephemeral: true 
                });
            }
            
            // Atualizar página baseado no botão
            switch (i.customId) {
                case 'primeira':
                    paginaAtual = 0;
                    break;
                case 'anterior':
                    paginaAtual = Math.max(0, paginaAtual - 1);
                    break;
                case 'proxima':
                    paginaAtual = Math.min(totalPaginas - 1, paginaAtual + 1);
                    break;
                case 'ultima':
                    paginaAtual = totalPaginas - 1;
                    break;
                default:
                    return;
            }
            
            const { embed: novoEmbed } = criarGridMangas(mangas, paginaAtual);
            
            // Atualizar botões
            const novaRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('primeira')
                        .setLabel('⏪')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(paginaAtual === 0),
                    new ButtonBuilder()
                        .setCustomId('anterior')
                        .setLabel('◀')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(paginaAtual === 0),
                    new ButtonBuilder()
                        .setCustomId('proxima')
                        .setLabel('▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(paginaAtual === totalPaginas - 1),
                    new ButtonBuilder()
                        .setCustomId('ultima')
                        .setLabel('⏩')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(paginaAtual === totalPaginas - 1),
                    new ButtonBuilder()
                        .setCustomId('ver_todos')
                        .setLabel('🔍 Ver no Site')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
                );
            
            await i.update({ embeds: [novoEmbed], components: [novaRow] });
        });
        
        collector.on('end', async () => {
            // Desabilitar botões quando o tempo acabar
            const disabledRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('primeira')
                        .setLabel('⏪')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('anterior')
                        .setLabel('◀')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('proxima')
                        .setLabel('▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('ultima')
                        .setLabel('⏩')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('ver_todos')
                        .setLabel('🔍 Ver no Site')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
                );
            
            await interaction.editReply({ components: [disabledRow] }).catch(() => {});
        });
        
        if (!interaction.member.permissions.has('Administrator')) {
            cooldowns.set(interaction.user.id, Date.now());
        }
    }
    
    // ===== /manga =====
    if (interaction.commandName === 'manga') {
        const nome = interaction.options.getString('nome');
        const manga = await getMangaByName(nome);
        
        if (!manga) {
            return interaction.editReply(`❌ Mangá "${nome}" não encontrado.`);
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x83d3f3)
            .setTitle(manga.titulo)
            .setThumbnail(manga.capa)
            .addFields(
                { name: '📅 Ano', value: manga.ano, inline: true },
                { name: '📖 Tipo', value: manga.tipo, inline: true },
                { name: '📊 Status', value: manga.status, inline: true },
                { name: '🏷️ Gêneros', value: manga.generos.join(', ') || 'N/A', inline: false }
            )
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('📖 Ler Mangá')
                    .setStyle(ButtonStyle.Link)
                    .setURL(manga.link)
            );
        
        await interaction.editReply({ embeds: [embed], components: [row] });
    }
    
    // ===== /site =====
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

app.get('/', (req, res) => {
    res.json({ message: 'Bot Reading está online!' });
});

// ========== INICIAR ==========
client.login(TOKEN);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 API rodando na porta ${PORT}`);
});

process.on('unhandledRejection', error => {
    console.error('Erro não tratado:', error.message);
});
