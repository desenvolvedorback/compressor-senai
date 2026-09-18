const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const knex = require('knex');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Middleware Global
app.use(cors());
app.use(express.json());

// 1. Conexão Banco de Dados (SQLite + WAL + Foreign Keys Ativas)
const db = knex({
  client: 'sqlite3',
  connection: {
    filename: process.env.DB_PATH || './database.sqlite'
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, cb) => {
      conn.run('PRAGMA journal_mode = WAL;', (err) => {
        if (err) return cb(err);
        conn.run('PRAGMA foreign_keys = ON;', cb);
      });
    }
  }
});

// Cache em Memória (<1ms) para Limites Mecânicos de Compressores
const cacheLimitesCompressores = new Map();

async function recarregarCacheCompressores() {
  try {
    const compressores = await db('compressores').select('id', 'limite_vibracao_alerta', 'limite_vibracao_critico');
    cacheLimitesCompressores.clear();
    compressores.forEach(c => cacheLimitesCompressores.set(c.id, c));
  } catch (err) {
    console.error('[CACHE] Erro ao carregar cache de compressores:', err.message);
  }
}

// 2. Schema DDL - 7 Tabelas Conforme Especificação
async function initDb() {
  try {
    // Tabela 1: compressores
    if (!(await db.schema.hasTable('compressores'))) {
      await db.schema.createTable('compressores', (table) => {
        table.increments('id').primary();
        table.string('tag').notNullable();
        table.string('modelo').notNullable();
        table.string('fabricante').nullable();
        table.date('data_instalacao').notNullable();
        table.string('status').nullable().defaultTo('operando');
        table.float('limite_vibracao_alerta').nullable();
        table.float('limite_vibracao_critico').nullable();
        table.timestamp('criado_em').defaultTo(db.fn.now());
      });
    }

    // Tabela 2: sensores
    if (!(await db.schema.hasTable('sensores'))) {
      await db.schema.createTable('sensores', (table) => {
        table.increments('id').primary();
        table.integer('compressor_id').unsigned().nullable().references('id').inTable('compressores').onDelete('SET NULL');
        table.string('codigo_sensor').notNullable();
        table.string('tipo').notNullable();
        table.string('modelo').nullable();
        table.date('data_ultima_calibracao').nullable();
        table.string('status').nullable().defaultTo('ativo');
      });
    }

    // Tabela 3: leituras_sensores
    if (!(await db.schema.hasTable('leituras_sensores'))) {
      await db.schema.createTable('leituras_sensores', (table) => {
        table.increments('id').primary();
        table.integer('sensor_id').unsigned().nullable().references('id').inTable('sensores').onDelete('CASCADE');
        table.integer('compressor_id').unsigned().nullable().references('id').inTable('compressores').onDelete('CASCADE');
        table.float('valor_rms').notNullable();
        table.text('valor_fft').nullable();
        table.float('temperatura').nullable();
        table.float('pressao').nullable();
        table.timestamp('timestamp').notNullable().defaultTo(db.fn.now());
      });
    }

    // Tabela 4: usuarios
    if (!(await db.schema.hasTable('usuarios'))) {
      await db.schema.createTable('usuarios', (table) => {
        table.increments('id_usuario').primary();
        table.string('nome').notNullable();
        table.integer('unidade').notNullable();
        table.string('cargo').notNullable();
      });
    }

    // Tabela 5: registro_trabalho
    if (!(await db.schema.hasTable('registro_trabalho'))) {
      await db.schema.createTable('registro_trabalho', (table) => {
        table.increments('id').primary();
        table.integer('compressor_id').unsigned().nullable().references('id').inTable('compressores').onDelete('CASCADE');
        table.string('tipo_estado').notNullable();
        table.integer('usuario_id').unsigned().notNullable().references('id_usuario').inTable('usuarios').onDelete('CASCADE');
        table.timestamp('data_inicio').notNullable();
        table.timestamp('data_fim').nullable();
        table.float('horas_calculadas').nullable();
      });
    }

    // Tabela 6: planos_preventiva
    if (!(await db.schema.hasTable('planos_preventiva'))) {
      await db.schema.createTable('planos_preventiva', (table) => {
        table.increments('id').primary();
        table.integer('compressor_id').unsigned().nullable().references('id').inTable('compressores').onDelete('CASCADE');
        table.string('descricao').notNullable();
        table.integer('intervalo_horas').notNullable();
        table.integer('intervalo_meses').notNullable();
        table.integer('proxima_revisao_horas').notNullable();
        table.date('proxima_revisao_data').notNullable();
      });
    }

    // Tabela 7: ordens_manutencao
    if (!(await db.schema.hasTable('ordens_manutencao'))) {
      await db.schema.createTable('ordens_manutencao', (table) => {
        table.increments('id').primary();
        table.integer('compressor_id').unsigned().nullable().references('id').inTable('compressores').onDelete('CASCADE');
        table.integer('plano_id').unsigned().nullable().references('id').inTable('planos_preventiva').onDelete('SET NULL');
        table.string('tipo').notNullable();
        table.string('status').nullable().defaultTo('aberta');
        table.string('descricao_problema').nullable();
        table.string('acoes_executadas').nullable();
        table.timestamp('data_abertura').nullable().defaultTo(db.fn.now());
        table.timestamp('data_conclusao').nullable();
        table.string('tecnico_responsavel').nullable();
      });
    }

    await recarregarCacheCompressores();
    console.log('[DATABASE] Tabelas e cache inicializados com sucesso.');
  } catch (err) {
    console.error('[DATABASE] Erro crítico ao inicializar banco:', err);
  }
}

initDb();

// 3. WebSockets (Ingestão em alta frequência + Broadcast)
io.on('connection', (socket) => {
  socket.on('telemetria:ingestao', async (data) => {
    try {
      const { sensor_id, compressor_id, valor_rms, valor_fft, temperatura, pressao, timestamp } = data;

      if (valor_rms === undefined || valor_rms === null) {
        return socket.emit('erro:ingestao', { mensagem: 'O campo valor_rms é obrigatório.' });
      }

      const payloadTimestamp = timestamp || new Date().toISOString();

      const [id] = await db('leituras_sensores').insert({
        sensor_id: sensor_id || null,
        compressor_id: compressor_id || null,
        valor_rms,
        valor_fft: typeof valor_fft === 'object' ? JSON.stringify(valor_fft) : valor_fft,
        temperatura: temperatura ?? null,
        pressao: pressao ?? null,
        timestamp: payloadTimestamp
      });

      // Checagem em memória (<1ms)
      const limites = cacheLimitesCompressores.get(compressor_id);
      let alertaCritico = false;
      let alertaWarning = false;

      if (limites) {
        if (limites.limite_vibracao_critico && valor_rms >= limites.limite_vibracao_critico) {
          alertaCritico = true;
          io.emit('alerta:critico', {
            compressor_id,
            mensagem: `Vibração crítica detectada: ${valor_rms} mm/s`,
            limite: limites.limite_vibracao_critico,
            timestamp: payloadTimestamp
          });
        } else if (limites.limite_vibracao_alerta && valor_rms >= limites.limite_vibracao_alerta) {
          alertaWarning = true;
          io.emit('alerta:atencao', {
            compressor_id,
            mensagem: `Vibração em nível de alerta: ${valor_rms} mm/s`,
            limite: limites.limite_vibracao_alerta,
            timestamp: payloadTimestamp
          });
        }
      }

      io.emit('telemetria:painel', {
        id,
        sensor_id,
        compressor_id,
        valor_rms,
        temperatura,
        pressao,
        alerta_critico: alertaCritico,
        alerta_atencao: alertaWarning,
        timestamp: payloadTimestamp
      });
    } catch (err) {
      console.error('[WEBSOCKET] Erro ao processar telemetria:', err.message);
      socket.emit('erro:ingestao', { mensagem: 'Erro interno ao salvar leitura.' });
    }
  });
});


// --- COMPRESSORES ---
app.get('/api/v1/compressores', async (req, res, next) => {
  try {
    const lista = await db('compressores').select('*').orderBy('id', 'asc');
    res.json(lista);
  } catch (err) { next(err); }
});

app.post('/api/v1/compressores', async (req, res, next) => {
  try {
    const { tag, modelo, fabricante, data_instalacao, status, limite_vibracao_alerta, limite_vibracao_critico } = req.body;

    if (!tag || !modelo || !data_instalacao) {
      return res.status(400).json({ erro: 'Campos tag, modelo e data_instalacao são obrigatórios.' });
    }

    const [id] = await db('compressores').insert({
      tag, modelo, fabricante, data_instalacao, status: status || 'operando',
      limite_vibracao_alerta, limite_vibracao_critico
    });

    await recarregarCacheCompressores();
    res.status(201).json({ id, status: 'ok', mensagem: 'Compressor criado com sucesso.' });
  } catch (err) { next(err); }
});

app.get('/api/v1/compressores/:id/dashboard', async (req, res, next) => {
  try {
    const { id } = req.params;
    const compressor = await db('compressores').where('id', id).first();
    if (!compressor) return res.status(404).json({ erro: 'Compressor não encontrado.' });

    const stats = await db('leituras_sensores')
      .where('compressor_id', id)
      .avg('valor_rms as vibracao_media_rms')
      .avg('temperatura as temperatura_media')
      .avg('pressao as pressao_media')
      .count('id as total_leituras')
      .first();

    const ultimosAlertas = await db('leituras_sensores')
      .where('compressor_id', id)
      .andWhere('valor_rms', '>=', compressor.limite_vibracao_alerta || 999)
      .count('id as total_alertas')
      .first();

    res.json({
      id: compressor.id,
      tag: compressor.tag,
      modelo: compressor.modelo,
      status_atual: compressor.status,
      periodo: 'historico_geral',
      vibracao_media_rms: Number((stats.vibracao_media_rms || 0).toFixed(2)),
      temperatura_media: Number((stats.temperatura_media || 0).toFixed(2)),
      pressao_media: Number((stats.pressao_media || 0).toFixed(2)),
      total_leituras: stats.total_leituras || 0,
      total_alertas: ultimosAlertas.total_alertas || 0
    });
  } catch (err) { next(err); }
});

app.get('/api/v1/compressores/:id/vibracao-historico', async (req, res, next) => {
  try {
    const { id } = req.params;
    const limit = Number(req.query.limit) || 100;

    const leituras = await db('leituras_sensores')
      .where('compressor_id', id)
      .select('timestamp', 'valor_rms', 'valor_fft', 'temperatura', 'pressao')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    const formatado = leituras.map(l => ({
      ...l,
      valor_fft: l.valor_fft ? JSON.parse(l.valor_fft) : null
    }));

    res.json({ compressor_id: Number(id), total: formatado.length, leituras: formatado });
  } catch (err) { next(err); }
});

// --- SENSORES ---
app.get('/api/v1/sensores', async (req, res, next) => {
  try {
    const lista = await db('sensores').select('*');
    res.json(lista);
  } catch (err) { next(err); }
});

app.post('/api/v1/sensores', async (req, res, next) => {
  try {
    const { compressor_id, codigo_sensor, tipo, modelo, data_ultima_calibracao, status } = req.body;
    if (!codigo_sensor || !tipo) {
      return res.status(400).json({ erro: 'codigo_sensor e tipo são obrigatórios.' });
    }

    const [id] = await db('sensores').insert({
      compressor_id, codigo_sensor, tipo, modelo, data_ultima_calibracao, status: status || 'ativo'
    });
    res.status(201).json({ id, status: 'ok' });
  } catch (err) { next(err); }
});

// --- USUÁRIOS ---
app.get('/api/v1/usuarios', async (req, res, next) => {
  try {
    const lista = await db('usuarios').select('*');
    res.json(lista);
  } catch (err) { next(err); }
});

app.post('/api/v1/usuarios', async (req, res, next) => {
  try {
    const { nome, unidade, cargo } = req.body;
    if (!nome || unidade === undefined || !cargo) {
      return res.status(400).json({ erro: 'Campos nome, unidade e cargo são obrigatórios.' });
    }

    const [id_usuario] = await db('usuarios').insert({ nome, unidade, cargo });
    res.status(201).json({ id_usuario, status: 'ok' });
  } catch (err) { next(err); }
});

// --- REGISTRO DE TRABALHO ---
app.get('/api/v1/registro-trabalho', async (req, res, next) => {
  try {
    const registros = await db('registro_trabalho').select('*').orderBy('data_inicio', 'desc');
    res.json(registros);
  } catch (err) { next(err); }
});

app.post('/api/v1/registro-trabalho', async (req, res, next) => {
  try {
    const { compressor_id, tipo_estado, usuario_id, data_inicio, data_fim, horas_calculadas } = req.body;
    if (!tipo_estado || !usuario_id || !data_inicio) {
      return res.status(400).json({ erro: 'tipo_estado, usuario_id e data_inicio são obrigatórios.' });
    }

    const [id] = await db('registro_trabalho').insert({
      compressor_id, tipo_estado, usuario_id, data_inicio, data_fim, horas_calculadas
    });
    res.status(201).json({ id, status: 'ok' });
  } catch (err) { next(err); }
});

// --- PLANOS PREVENTIVA ---
app.get('/api/v1/planos-preventiva', async (req, res, next) => {
  try {
    const planos = await db('planos_preventiva').select('*');
    res.json(planos);
  } catch (err) { next(err); }
});

app.post('/api/v1/planos-preventiva', async (req, res, next) => {
  try {
    const { compressor_id, descricao, intervalo_horas, intervalo_meses, proxima_revisao_horas, proxima_revisao_data } = req.body;
    if (!descricao || intervalo_horas === undefined || intervalo_meses === undefined || proxima_revisao_horas === undefined || !proxima_revisao_data) {
      return res.status(400).json({ erro: 'Todos os parâmetros obrigatórios do plano de preventiva devem ser enviados.' });
    }

    const [id] = await db('planos_preventiva').insert({
      compressor_id, descricao, intervalo_horas, intervalo_meses, proxima_revisao_horas, proxima_revisao_data
    });
    res.status(201).json({ id, status: 'ok' });
  } catch (err) { next(err); }
});

// --- ORDENS DE MANUTENÇÃO ---
app.get('/api/v1/manutencao/ordens', async (req, res, next) => {
  try {
    const ordens = await db('ordens_manutencao').select('*').orderBy('data_abertura', 'desc');
    res.json(ordens);
  } catch (err) { next(err); }
});

app.post('/api/v1/manutencao/ordens', async (req, res, next) => {
  try {
    const { compressor_id, plano_id, tipo, status, descricao_problema, acoes_executadas, tecnico_responsavel } = req.body;
    if (!tipo) {
      return res.status(400).json({ erro: 'O campo tipo é obrigatório (ex: preventiva, corretiva).' });
    }

    const [id] = await db('ordens_manutencao').insert({
      compressor_id, plano_id, tipo, status: status || 'aberta',
      descricao_problema, acoes_executadas, tecnico_responsavel,
      data_abertura: new Date().toISOString()
    });
    res.status(201).json({ id, status: 'ok' });
  } catch (err) { next(err); }
});

app.get('/', async (req, res, next) => {
  res('index.html');
});

// Middleware Global para Tratamento de Erros REST
app.use((err, req, res, next) => {
  console.error('[ERRO SERVER]:', err.stack);
  res.status(500).json({
    erro: 'Erro interno no servidor',
    detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 5. Cron Job Diário (00:00) - Verificação de Preventivas
cron.schedule('0 0 * * *', async () => {
  try {
    const planos = await db('planos_preventiva').select('*');
    const hoje = new Date().toISOString().split('T')[0];

    for (const plano of planos) {
      if (plano.proxima_revisao_data <= hoje) {
        io.emit('alerta:manutencao', {
          compressorId: plano.compressor_id,
          planoId: plano.id,
          mensagem: `Preventiva pendente para o compressor ID ${plano.compressor_id}:${plano.descricao}`
        });
      }
    }
  } catch (err) {
    console.error('[CRON] Erro ao checar prazos de preventiva:', err.message);
  }
});

// Cores ANSI para o terminal
const RED = '\x1b[31m';
const WHITE = '\x1b[37m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Banner em arte ASCII
const bannerFrames = [
`
${RED}╔════════════════════════════════════════════════════════════════════════════════════╗${RESET}
${RED}║${RESET}                                                                            
${RED}║${RESET}   ${WHITE}${BOLD}███████╗███████╗███╗   ██╗ █████╗ ██╗${RESET}                                   
${RED}║${RESET}   ${WHITE}${BOLD}██╔════╝██╔════╝████╗  ██║██╔══██╗██║${RESET}                                   
${RED}║${RESET}   ${WHITE}${BOLD}███████╗█████╗  ██╔██╗ ██║███████║██║${RESET}                                   
${RED}║${RESET}   ${WHITE}${BOLD}╚════██║██╔══╝  ██║╚██╗██║██╔══██║██║${RESET}                                   
${RED}║${RESET}   ${WHITE}${BOLD}███████║███████╗██║ ╚████║██║  ██║██║${RESET}                                   
${RED}║${RESET}   ${WHITE}${BOLD}╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝${RESET}                                   
${RED}║${RESET}                                                                            
${RED}╠════════════════════════════════════════════════════════════════════════════════════╣${RESET}
${RED}║${RESET} ${WHITE}${BOLD}📦 PROJETO:${RESET} Sistema de Monitoramento de Compressores                         
${RED}║${RESET} ${WHITE}${BOLD}🏫 INSTITUIÇÃO:${RESET} SENAI                                                    
${RED}║${RESET} ${WHITE}${BOLD}⚙️  STATUS:${RESET} Inicializando módulos...    
${RED}║${RESET} ${WHITE}${BOLD}⚙️  STATUS-INFO:${RESET} Banco de dados Iniciado.... 
${RED}║${RESET} ${WHITE}${BOLD}⚙️  STATUS-INFO:${RESET} Backend Iniciado...
${RED}║${RESET} ${WHITE}${BOLD}⚙️  STATUS-INFO:${RESET} Integração IOT Iniciado...
${RED}║${RESET} ${WHITE}${BOLD}⚙️  STATUS-INFO:${RESET} Frontend Iniciado... 
${RED}║${RESET} ${WHITE}${BOLD}${RESET} SENAI • 2026                                      
${RED}╚════════════════════════════════════════════════════════════════════════════════════╝${RESET}

 ████ █████ █   █  ███  ███    ████   ███  █████ █   █  ███   ███  █████ █   █   
█ ░░░░█░░░░░██  █░█ ░░█  █░░   █░░░█ █ ░░█  ░█░░░█░  █░█ ░░░ █ ░░█  ░█░░░█░  █░  
 ███░░████░░█░█ █░█████░ █░░░  ████░░█░ ░█░  █░░░█░░ █░█░ ░░░█████░  █░░░█░░ █░░ 
  ░░█ █░░░░ █░░██░█░░░█░░█░░   █░░░█ █░░ █░░ █░░ █░░ █░█░░   █░░░█░░ █░░ █░░ █░░ 
████░░█████░█░░ █░█░░░█░███░   ████░░ ███ ░░ █░░  ███ ░░███  █░░░█░░ █░░  ███ ░░ 
 ░░░░ ░░░░░░ ░░  ░░░░  ░░░░░    ░░░░ ░ ░░░ ░  ░░   ░░░ ░ ░░░  ░░  ░░  ░░   ░░░ ░ 
  ░░░░  ░░░░░ ░   ░ ░   ░ ░░░    ░░░░   ░░░    ░    ░░░   ░░░  ░   ░   ░    ░░░  
`
];

// Função para rodar a animação
async function animarBanner() {
  console.clear();
  for (const frame of bannerFrames) {
    console.clear();
    console.log(frame);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

// Subida do Servidor com Animação
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  await animarBanner();
  console.log(`\n  ${WHITE}${BOLD} STATUS:${RESET}${RED}Servidor Ativo e Escutando na Porta ${PORT}${RESET}\n`);
});
