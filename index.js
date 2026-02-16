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
const API_MANGAS_URL = `${SITE_URL}/fazer_login/api_mangas.php`;
const API_ULTIMO_MANGA_URL = `${SITE_URL}/fazer_login/api_ultimo_manga.php`;
const API_PERFIL_URL = `${SITE_URL}/fazer_login/api_perfil.php`;
const API_SITE_STATS = `${SITE_URL}/fazer_login/site_stats.php`;
const BANNER_URL = `${SITE_URL}/bannersdiscord/ipsite.jpg`;

// Canal para anúncios de novos mangás
const CANAL_NOVOS_MANGAS = '1459649166581174444';

if (!TOKEN) {
    console.error('❌ ERRO: Token não encontrado!');
    process.exit(1);
}

// ========== CACHES ==========
let mangaCache = { data: null, timestamp: 0 };
let titulosCache = { data: [], timestamp: 0 };
let perfisCache = new Map();
const CACHE_DURATION = 300000; // 5 minutos
const CACHE_TITULOS_DURATION = 60000; // 1 minuto

// Cache para último mangá (para evitar anúncios duplicados)
let ultimoMangaEnviado = {
    id: 0,
    timestamp: 0
};

// Cache de membros do Discord
let discordMembersCache = {
    total: 0,
    online: 0,
    idle: 0,
    dnd: 0,
    offline: 0,
    bots: 0,
    timestamp: 0
};
const DISCORD_CACHE_DURATION = 30000; // 30 segundos

// Cooldowns
const cooldowns = new Map();
const MANGAS_COOLDOWN = 300000; // 5 minutos

// ========== FUNÇÃO PARA VERIFICAR NOVOS MANGÁS ==========
async function verificarNovosMangas() {
    try {
        console.log('🔍 Verificando se há novos mangás...');
        
        const response = await fetch(API_ULTIMO_MANGA_URL, { 
            timeout: 5000,
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            console.error('Erro ao buscar último mangá:', response.status);
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.data) {
            console.log('❌ Nenhum mangá encontrado na API');
            return;
        }
        
        const novoManga = data.data;
        
        // Verificar se é um mangá novo (ID diferente do último enviado)
        if (novoManga.id > ultimoMangaEnviado.id) {
            console.log(`🎉 Novo mangá detectado! ID: ${novoManga.id}, Título: ${novoManga.titulo}`);
            
            // Enviar anúncio no Discord
            await anunciarNovoManga(novoManga);
            
            // Atualizar cache
            ultimoMangaEnviado = {
                id: novoManga.id,
                timestamp: Date.now()
            };
        } else {
            console.log('✅ Nenhum mangá novo detectado');
        }
        
    } catch (error) {
        console.error('Erro ao verificar novos mangás:', error.message);
    }
}

// ========== FUNÇÃO PARA ANUNCIAR NOVO MANGÁ ==========
async function anunciarNovoManga(manga) {
    try {
        const canal = await client.channels.fetch(CANAL_NOVOS_MANGAS);
        const CARGO_ID = '1462670226612031550';
        
        console.log('📦 Dados recebidos da API:', manga);
        
        // IMPORTANTE: Pegar os dados do jeito que vieram da API
        // A API pode mandar com acentos ou sem, então fazemos fallback
        const titulo = manga.titulo || manga.título || 'Sem título';
        const subtitulo = manga.subtitulo || manga.subtítulo || '';
        const capaUrl = formatCapaUrl(manga.capa);
        const autor = manga.autor || 'Não informado';
        const ano = String(manga.ano || 'N/A');
        const status = manga.status || 'N/A';
        const tipo = manga.tipo || 'N/A';
        const sinopse = manga.sinopse || 'Sinopse não disponível';
        
        // Processar gêneros
        let generos = [];
        if (subtitulo) {
            generos = subtitulo.split(',').map(g => g.trim()).filter(g => g);
        }
        
        // Limitar sinopse
        let sinopseResumida = sinopse;
        if (sinopseResumida.length > 800) {
            sinopseResumida = sinopseResumida.substring(0, 800) + '...';
        }
        
        // Criar embed
        const embed = new EmbedBuilder()
            .setColor(0x83d3f3)
            .setTitle(`📚 NOVO MANGÁ NA BIBLIOTECA!`)
            .setDescription(`### **${titulo}**`)
            .setImage(capaUrl)
            .addFields(
                { name: '📖 Título', value: titulo, inline: false },
                { name: '✍️ Autor', value: autor, inline: true },
                { name: '📅 Ano', value: ano, inline: true },
                { name: '📖 Tipo', value: tipo, inline: true },
                { name: '📊 Status', value: status, inline: true }
            )
            .setFooter({ text: 'Clique no botão abaixo para começar a ler!' })
            .setTimestamp();
        
        // Adicionar gêneros
        if (generos.length > 0) {
            embed.addFields({ 
                name: '🏷️ Gêneros', 
                value: generos.map(g => `\`${g}\``).join(' • '), 
                inline: false 
            });
        }
        
        // Adicionar sinopse
        embed.addFields({ 
            name: '📝 Sinopse', 
            value: sinopseResumida, 
            inline: false 
        });
        
        // Botão
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('📖 LER AGORA')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${SITE_URL}/fazer_login/detalhes.php?id=${manga.id}`)
                    .setEmoji('🔥')
            );
        
        // Enviar
        await canal.send({
            content: `<@&${CARGO_ID}> 📢 **Novo mangá disponível!**`,
            embeds: [embed],
            components: [row]
        });
        
        console.log(`✅ Anúncio enviado: ${titulo}`);
        
    } catch (error) {
        console.error('Erro no anúncio:', error);
        
        // Fallback
        try {
            const canal = await client.channels.fetch(CANAL_NOVOS_MANGAS);
            const titulo = manga.titulo || manga.título || 'Mangá';
            await canal.send(`📚 **NOVO MANGÁ:** ${titulo}\n${SITE_URL}/fazer_login/detalhes.php?id=${manga.id}`);
        } catch (e) {
            console.error('Erro total:', e);
        }
    }
}

// ========== FUNÇÃO PARA ATUALIZAR CACHE DO DISCORD ==========
async function updateDiscordMembersCache() {
    const now = Date.now();
    if (discordMembersCache.timestamp && (now - discordMembersCache.timestamp) < DISCORD_CACHE_DURATION) {
        return discordMembersCache;
    }
    
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
        
        discordMembersCache = {
            total: humanos.size,
            online: online,
            idle: idle,
            dnd: dnd,
            offline: humanos.size - online - idle - dnd,
            bots: members.filter(m => m.user.bot).size,
            timestamp: now
        };
        
        console.log(`✅ Membros Discord: ${online} online, ${humanos.size} totais`);
        return discordMembersCache;
    } catch (error) {
        console.error('Erro ao atualizar cache do Discord:', error.message);
        return discordMembersCache;
    }
}

// ========== ROTA PARA O SITE CONSULTAR STATUS DO DISCORD ==========
app.get('/api/stats', async (req, res) => {
    try {
        const now = Date.now();
        if (!discordMembersCache.timestamp || (now - discordMembersCache.timestamp) > DISCORD_CACHE_DURATION) {
            await updateDiscordMembersCache();
        }
        
        return res.json({
            online: discordMembersCache.online,
            idle: discordMembersCache.idle,
            dnd: discordMembersCache.dnd,
            total: discordMembersCache.total,
            bots: discordMembersCache.bots,
            timestamp: discordMembersCache.timestamp
        });
        
    } catch (error) {
        console.error('Erro na rota /api/stats:', error.message);
        res.status(500).json({ 
            error: 'Erro interno',
            online: 0,
            idle: 0,
            dnd: 0,
            total: 0,
            bots: 0
        });
    }
});

// ========== FUNÇÕES DE API ==========
async function fetchFromAPI(baseURL, endpoint, params = '') {
    try {
        const response = await fetch(`${baseURL}?acao=${endpoint}${params}`, { 
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
    
    const data = await fetchFromAPI(API_MANGAS_URL, 'titulos');
    if (data && Array.isArray(data)) {
        titulosCache = { data, timestamp: agora };
        return data;
    }
    return titulosCache.data || [];
}

async function getUserNames(nome) {
    const data = await fetchFromAPI(API_PERFIL_URL, 'buscar', `&nome=${encodeURIComponent(nome)}`);
    return data || [];
}

async function getUserProfile(nome) {
    const cached = perfisCache.get(nome);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        return cached.data;
    }
    
    const data = await fetchFromAPI(API_PERFIL_URL, 'perfil', `&nome=${encodeURIComponent(nome)}`);
    if (data) {
        perfisCache.set(nome, { data, timestamp: Date.now() });
        return data;
    }
    return null;
}

async function getAllMangas() {
    const now = Date.now();
    
    if (mangaCache.data && (now - mangaCache.timestamp) < CACHE_DURATION) {
        return mangaCache.data;
    }
    
    const data = await fetchFromAPI(API_MANGAS_URL, 'lista');
    if (data && Array.isArray(data)) {
        const mangas = data.map(manga => ({
            id: manga.id,
            titulo: manga.titulo || 'Sem título',
            tituloLower: (manga.titulo || '').toLowerCase(),
            ano: String(manga.ano || 'N/A'),
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
    const data = await fetchFromAPI(API_MANGAS_URL, 'busca', `&nome=${encodeURIComponent(nome)}`);
    if (!data) return null;
    
    let generos = [];
    if (data.subtitulo) {
        generos = data.subtitulo.split(',').map(g => g.trim()).filter(g => g);
    }
    
    return {
        id: data.id,
        titulo: data.titulo || 'Sem título',
        ano: String(data.ano || 'N/A'),
        tipo: data.tipo || 'N/A',
        status: data.status || 'N/A',
        generos: generos,
        capa: formatCapaUrl(data.capa),
        link: `${SITE_URL}/fazer_login/detalhes.php?id=${data.id}`
    };
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

// ========== FUNÇÃO PARA CRIAR GRID DE MANGÁS ==========
function criarGridMangas(mangas, pagina = 0, itensPorPagina = 10) {
    if (!mangas || mangas.length === 0) {
        return {
            embed: new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle('📚 Biblioteca Reading')
                .setDescription('Nenhum mangá encontrado.')
                .setTimestamp(),
            totalPaginas: 0
        };
    }
    
    const start = pagina * itensPorPagina;
    const end = Math.min(start + itensPorPagina, mangas.length);
    const paginaMangas = mangas.slice(start, end);
    const totalPaginas = Math.ceil(mangas.length / itensPorPagina);
    
    let descricao = '';
    paginaMangas.forEach((manga, index) => {
        const numero = start + index + 1;
        descricao += `**${numero}.** [${manga.titulo}](${manga.link}) ─ ${manga.ano} • ${manga.tipo}\n`;
    });
    
    const embed = new EmbedBuilder()
        .setColor(0x83d3f3)
        .setTitle('📚 Biblioteca Reading')
        .setDescription(descricao || 'Nenhum mangá nesta página.')
        .addFields(
            { name: '📊 Total', value: `**${mangas.length}** mangás`, inline: true },
            { name: '📄 Página', value: `**${pagina + 1}/${totalPaginas}**`, inline: true }
        )
        .setFooter({ text: 'Use os botões para navegar' })
        .setTimestamp();
    
    if (paginaMangas.length > 0 && paginaMangas[0].capa) {
        embed.setThumbnail(paginaMangas[0].capa);
    }
    
    return { embed, totalPaginas };
}

// ========== COMANDOS SLASH ==========
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Mostra quantos usuários estão online no Discord e no site'),
    
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
        .setName('perfil')
        .setDescription('Mostra perfil de um usuário do site')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do usuário no site')
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
    console.log(`📌 Canal de novos mangás: ${CANAL_NOVOS_MANGAS}`);
    console.log(`📌 API do site: ${API_MANGAS_URL}`);
    
    await updateDiscordMembersCache();
    
    // Verificar o último mangá ao iniciar
    try {
        const response = await fetch(API_ULTIMO_MANGA_URL, { timeout: 5000 });
        const data = await response.json();
        if (data.success && data.data) {
            ultimoMangaEnviado.id = data.data.id;
            ultimoMangaEnviado.timestamp = Date.now();
            console.log(`📚 Último mangá no banco: ID ${ultimoMangaEnviado.id} - ${data.data.titulo}`);
        }
    } catch (error) {
        console.error('Erro ao buscar último mangá na inicialização:', error.message);
    }
    
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Comandos registrados!');
    } catch (error) {
        console.error('❌ Erro registrando comandos:', error);
    }
    
    // Verificar novos mangás a cada 2 minutos
    setInterval(verificarNovosMangas, 120000); // 2 minutos
    
    // Atualizar cache do Discord a cada 30 segundos
    setInterval(updateDiscordMembersCache, DISCORD_CACHE_DURATION);
    
    // Fazer uma verificação inicial após 10 segundos
    setTimeout(verificarNovosMangas, 10000);
});

// ========== AUTOCOMPLETE ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isAutocomplete()) return;
    
    try {
        const focused = interaction.options.getFocused().toLowerCase();
        
        if (interaction.commandName === 'manga') {
            const titles = await Promise.race([
                getMangaTitles(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
            ]);
            
            if (!titles || !Array.isArray(titles)) {
                return await interaction.respond([]).catch(() => {});
            }
            
            const filtered = titles
                .filter(t => t && t.toLowerCase().includes(focused))
                .slice(0, 25);
            
            await interaction.respond(
                filtered.map(t => ({ name: t.substring(0, 100), value: t.substring(0, 100) }))
            ).catch(() => {});
        }
        
        if (interaction.commandName === 'perfil') {
            const users = await Promise.race([
                getUserNames(focused),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
            ]);
            
            if (!users || !Array.isArray(users)) {
                return await interaction.respond([]).catch(() => {});
            }
            
            const filtered = users
                .filter(u => u && u.toLowerCase().includes(focused))
                .slice(0, 25);
            
            await interaction.respond(
                filtered.map(u => ({ name: u.substring(0, 100), value: u.substring(0, 100) }))
            ).catch(() => {});
        }
    } catch (error) {
        console.error('Erro no autocomplete:', error.message);
        try { await interaction.respond([]); } catch (e) {}
    }
});

// ========== COMANDOS ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        await interaction.deferReply({ ephemeral: true });
        
        // ===== /status =====
        if (interaction.commandName === 'status') {
            const discordStats = await updateDiscordMembersCache();
            
            let siteOnline = 0, siteTotal = 0;
            try {
                const response = await fetch(API_SITE_STATS, { 
                    timeout: 5000,
                    headers: { 'Accept': 'application/json' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    siteOnline = data.online || 0;
                    siteTotal = data.total || 0;
                }
            } catch (error) {
                console.error('Erro ao buscar stats do site:', error.message);
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle('📊 Status Reading')
                .addFields(
                    { 
                        name: '👥 Discord', 
                        value: `🟢 **${discordStats.online}** online\n🌙 **${discordStats.idle}** ausente\n⛔ **${discordStats.dnd}** ocupado\n⚫ **${discordStats.offline}** offline\n🤖 **${discordStats.bots}** bots`, 
                        inline: true 
                    },
                    { 
                        name: '🌐 Site', 
                        value: `🟢 **${siteOnline}** online agora\n📚 **${siteTotal}** usuários totais\n⏱️ Últimos 15 minutos`, 
                        inline: true 
                    }
                )
                .setFooter({ text: 'Atualizado a cada 30s' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /mangas =====
        if (interaction.commandName === 'mangas') {
            if (!interaction.member.permissions.has('Administrator')) {
                const cooldown = cooldowns.get(interaction.user.id);
                if (cooldown && Date.now() - cooldown < MANGAS_COOLDOWN) {
                    const minutes = Math.ceil((MANGAS_COOLDOWN - (Date.now() - cooldown)) / 60000);
                    return interaction.editReply(`⏳ Aguarde ${minutes} minuto(s) para usar este comando novamente.`);
                }
            }
            
            const mangas = await getAllMangas();
            
            if (!mangas || mangas.length === 0) {
                return interaction.editReply('❌ Nenhum mangá encontrado no banco de dados.');
            }
            
            let paginaAtual = 0;
            const { embed, totalPaginas } = criarGridMangas(mangas, paginaAtual);
            
            const row = new ActionRowBuilder();
            
            if (totalPaginas > 1) {
                row.addComponents(
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
                        .setDisabled(paginaAtual === totalPaginas - 1)
                );
            }
            
            row.addComponents(
                new ButtonBuilder()
                    .setLabel('🔍 Ver no Site')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
            );
            
            const response = await interaction.editReply({
                embeds: [embed],
                components: row.components.length > 0 ? [row] : []
            });
            
            if (totalPaginas <= 1) {
                if (!interaction.member.permissions.has('Administrator')) {
                    cooldowns.set(interaction.user.id, Date.now());
                }
                return;
            }
            
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300000
            });
            
            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ 
                        content: '❌ Apenas quem usou o comando pode navegar.', 
                        ephemeral: true 
                    });
                }
                
                switch (i.customId) {
                    case 'primeira': paginaAtual = 0; break;
                    case 'anterior': paginaAtual = Math.max(0, paginaAtual - 1); break;
                    case 'proxima': paginaAtual = Math.min(totalPaginas - 1, paginaAtual + 1); break;
                    case 'ultima': paginaAtual = totalPaginas - 1; break;
                    default: return;
                }
                
                const { embed: novoEmbed } = criarGridMangas(mangas, paginaAtual);
                
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
                            .setLabel('🔍 Ver no Site')
                            .setStyle(ButtonStyle.Link)
                            .setURL(`${SITE_URL}/fazer_login/busca_mangas.php`)
                    );
                
                await i.update({ embeds: [novoEmbed], components: [novaRow] });
            });
            
            collector.on('end', async () => {
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
        
        // ===== /perfil =====
        if (interaction.commandName === 'perfil') {
            const nome = interaction.options.getString('nome');
            const perfil = await getUserProfile(nome);
            
            if (!perfil) {
                return interaction.editReply(`❌ Usuário "${nome}" não encontrado.`);
            }
            
            const ultimoAcesso = perfil.ultimo_acesso 
                ? `<t:${Math.floor(new Date(perfil.ultimo_acesso).getTime() / 1000)}:R>`
                : 'Nunca acessou';
            
            const ultimoManga = perfil.ultimo_manga || 'Nenhum mangá lido ainda';
            
            let vipStatus = '❌ Não VIP';
            if (perfil.vip_status == 1) {
                vipStatus = '✅ VIP Ativo';
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x83d3f3)
                .setTitle(`👤 Perfil de ${perfil.usuario}`)
                .setDescription(`📊 **Nível:** ${perfil.nivel || 1}`)
                .addFields(
                    { name: '💎 VIP', value: vipStatus, inline: true },
                    { name: '📚 Mangás Lidos', value: `**${perfil.mangas_lidos || 0}**`, inline: true },
                    { name: '🕒 Último Acesso', value: ultimoAcesso, inline: false },
                    { name: '📖 Último Mangá', value: ultimoManga, inline: false }
                )
                .setFooter({ text: 'Clique no botão para ver no site' })
                .setTimestamp();
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('👤 Ver Perfil no Site')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`${SITE_URL}/fazer_login/perfil.php?user=${encodeURIComponent(perfil.usuario)}`)
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
                            .setLabel('🚀 Acessar Site')
                            .setStyle(ButtonStyle.Link)
                            .setURL(SITE_URL)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch {
                const embed = new EmbedBuilder()
                    .setColor(0x83d3f3)
                    .setTitle('🌐 Reading')
                    .setDescription('Leia mangás online, gratuitamente!')
                    .setImage(BANNER_URL);
                
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('🚀 Acessar Site')
                            .setStyle(ButtonStyle.Link)
                            .setURL(SITE_URL)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            }
        }
        
    } catch (error) {
        console.error('Erro no comando:', error);
        try {
            await interaction.editReply('❌ Ocorreu um erro ao processar o comando.');
        } catch (e) {}
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
    console.log(`🌐 Rota /api/stats disponível para o site`);
    console.log(`🌐 Health check: /health`);
});

process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado:', error.message);
});




