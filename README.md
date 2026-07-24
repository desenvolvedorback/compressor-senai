# Especificação de Projeto: Sistema de Monitoramento Online de Compressores

Este documento apresenta a arquitetura detalhada, a modelagem de banco de dados e a estrutura de diretórios para um sistema Full-Stack em JavaScript/Node.js dedicado ao monitoramento em tempo real de compressores industriais. O sistema cobre mecânica (vibração), tempo de trabalho, gestão de sensores e automação de manutenção preventiva/preditiva.


⚠️ Aviso Importante: Este é um projeto proprietário e educacional. Todos os direitos são reservados. Não é permitida a cópia ou utilização em outros sistemas sem um acordo formal escrito com os autores. Veja o arquivo LICENSE para mais detalhes.

## 1. Visão Geral da Arquitetura

O sistema é dividido em três camadas principais, utilizando uma arquitetura orientada a eventos e orientada a serviços para suportar o fluxo de dados em tempo real:

1. **Banco de Dados (SQL):** Armazenamento relacional para configurações de ativos, planos de manutenção, logs históricos de trabalho e leituras de sensores condensadas.
2. **Back-end (Node.js):** API RESTful para operações CRUD e gerenciamento de regras de negócios, combinada com um servidor WebSocket (Socket.io) para a ingestão e distribuição de telemetria em tempo real.
3. **Front-end (JavaScript modern/React ou Vue):** Painel operacional (Dashboard) com gráficos de linha do tempo e indicadores de status em tempo real.

[ Sensores / IoT (MQTT) ]
│
▼
[ Node.js API ] ◄──(WebSockets)──► [ Front-end Dashboard ]
│
▼
[ Banco SQL ]

## 2. Modelagem do Banco de Dados (SQL)

Abaixo está o modelo relacional em SQL (compatível com PostgreSQL ou MySQL). O design prioriza a integridade referencial e o histórico completo de operações e telemetria.


-- Criação do banco de dados (Exemplo PostgreSQL)
CREATE DATABASE monitoramento_compressores;

-- 1. Tabela de Compressores
CREATE TABLE compressores (
    id SERIAL PRIMARY KEY,
    tag VARCHAR(50) UNIQUE NOT NULL, -- Ex: COMP-01, COMP-02
    modelo VARCHAR(100) NOT NULL,
    fabricante VARCHAR(100),
    data_instalacao DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'operando' CHECK (status IN ('operando', 'manutencao', 'parado', 'falha')),
    limite_vibracao_alerta REAL DEFAULT 4.5, -- mm/s RMS
    limite_vibracao_critico REAL DEFAULT 7.1,  -- mm/s RMS
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Sensores Cadastrados
CREATE TABLE sensores (
    id SERIAL PRIMARY KEY,
    compressor_id INT REFERENCES compressores(id) ON DELETE CASCADE,
    codigo_sensor VARCHAR(50) UNIQUE NOT NULL, -- Ex: SEN-VIB-01
    tipo VARCHAR(30) NOT NULL, -- 'vibracao', 'temperatura', 'pressao', 'horimetro'
    modelo VARCHAR(100),
    data_ultima_calibracao DATE,
    status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'defeito', 'descalibrado'))
);

-- 3. Histórico de Leituras de Sensores (Telemetria)
-- Nota: Em produção real de alta frequência, esta tabela pode ser otimizada via partições.
CREATE TABLE leituras_sensores (
    id BIGSERIAL PRIMARY KEY,
    sensor_id INT REFERENCES sensores(id) ON DELETE CASCADE,
    compressor_id INT REFERENCES compressores(id) ON DELETE CASCADE,
    valor_rms REAL NOT NULL, -- Para vibração ou leitura escalar principal
    valor_fft TEXT, -- Opcional: Dados em JSON/String para espectro de frequência
    temperatura REAL, -- Graus Celsius (se integrado ou leitura combinada)
    pressao REAL, -- Bar / PSI (se aplicável)
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Registro de Horas de Trabalho (Horímetro)
CREATE TABLE registro_trabalho (
    id SERIAL PRIMARY KEY,
    compressor_id INT REFERENCES compressores(id) ON DELETE CASCADE,
    tipo_estado VARCHAR(20) NOT NULL CHECK (tipo_estado IN ('carga', 'vazio')),
    data_inicio TIMESTAMP NOT NULL,
    data_fim TIMESTAMP,
    horas_calculadas REAL GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (data_fim - data_inicio)) / 3600) STORED
);

-- 5. Planos de Manutenção Preventiva
CREATE TABLE planos_preventiva (
    id SERIAL PRIMARY KEY,
    compressor_id INT REFERENCES compressores(id) ON DELETE CASCADE,
    descricao VARCHAR(255) NOT NULL,
    intervalo_horas INT NOT NULL, -- Ex: A cada 2000 horas
    intervalo_meses INT NOT NULL, -- Ex: A cada 6 meses (o que ocorrer primeiro)
    proxima_revisao_horas INT NOT NULL, -- Valor do horímetro em que deve ocorrer
    proxima_revisao_data DATE NOT NULL
);

-- 6. Ordens de Serviço (Histórico de Manutenção)
CREATE TABLE ordens_manutencao (
    id SERIAL PRIMARY KEY,
    compressor_id INT REFERENCES compressores(id) ON DELETE CASCADE,
    plano_id INT REFERENCES planos_preventiva(id) ON DELETE SET NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('preventiva', 'corretiva', 'preditiva')),
    status VARCHAR(20) DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_execucao', 'concluida', 'cancelada')),
    descricao_problema TEXT,
    acoes_executadas TEXT,
    data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_conclusao TIMESTAMP,
    tecnico_responsavel VARCHAR(100)
);

-- Índices para otimização de busca por tempo real
CREATE INDEX idx_leituras_timestamp ON leituras_sensores(timestamp DESC);
CREATE INDEX idx_leituras_compressor ON leituras_sensores(compressor_id);
3. Back-end (Node.js & Express / Socket.io)
O Back-end gerencia a API REST e os canais WebSocket. Ele escuta a telemetria, verifica limites de vibração e atualiza o horímetro acumulado.

Estrutura de Pastas (Back-end)
backend/
├── src/
│   ├── config/
│   │   ├── database.js       # Conexão com o banco (Knex / Prisma / PG Pool)
│   │   └── websocket.js      # Inicialização do Socket.io
│   ├── controllers/
│   │   ├── compressor.controller.js
│   │   ├── telemetria.controller.js
│   │   └── manutencao.controller.js
│   ├── models/               # Queries SQL estruturadas ou Mapeamento ORM
│   ├── routes/
│   │   ├── api.routes.js     # Rotas HTTP REST
│   │   └── ws.events.js      # Manipuladores de eventos WebSocket
│   ├── services/
│   │   ├── analise.service.js      # Regras de limite de vibração/alerta
│   │   └── manutencao.service.js   # Verificação de gatilhos de preventiva
│   ├── jobs/
│   │   └── cron.jobs.js      # Verificação diária de horas e datas preventivas
│   └── server.js             # Ponto de entrada da aplicação
├── package.json
└── README.md
Endpoints principais da API REST (/api/v1)
GET /compressores -> Retorna lista de compressores com status e horímetro atual.

GET /compressores/:id/dashboard -> Dados consolidados das últimas 24h (médias de vibração, alarmes).

GET /compressores/:id/vibracao-historico -> Dados brutos e FFT para gráficos de engenharia preditiva.

POST /manutencao/ordens -> Abertura manual ou automática de ordens de serviço.

GET /manutencao/preventivas-pendentes -> Lista o que está próximo do gatilho de horas/tempo.

POST /sensores/calibracao -> Atualiza a data de calibração do sensor.

Fluxo do WebSocket (Real-Time)
Evento telemetria:enviar (Entrada): O simulador/gateway IoT envia { compressor_id, sensor_id, rms, temperatura, estado_trabalho }.

Lógica Interna: 1. Grava no banco de dados.
2. Compara rms com limite_vibracao_critico. Se estourar, abre Ordem de Serviço Corretiva imediata e dispara alerta.
3. Atualiza o horímetro se o estado for 'carga'.

Evento telemetria:painel (Saída): Emite os dados limpos para os navegadores conectados no Front-end em tempo real.

4. Front-end (Single Page Application - React/Vue/Vanilla JS)
O Front-end consome a API REST para históricos e se conecta via WebSocket para atualizações dinâmicas na tela sem necessidade de recarregar a página.

Estrutura de Pastas (Front-end - Padrão Componentizado)
frontend/
├── public/
├── src/
│   ├── assets/               # CSS, imagens
│   ├── components/
│   │   ├── CardCompressor.jsx  # Mini painel de status (Vibração, Horímetro, Modo)
│   │   ├── GraficoLinha.jsx    # Componente de Gráfico em tempo real (Chart.js / ApexCharts)
│   │   ├── ListaAlertas.jsx    # Feed de alertas em tempo real (Toasts / Notificações)
│   │   └── TabelaPreventivas.jsx
│   ├── contexts/
│   │   └── SocketContext.jsx   # Contexto global de conexão WebSocket
│   ├── pages/
│   │   ├── Dashboard.jsx       # Tela Principal (Online)
│   │   ├── AnaliseMecanica.jsx # Tela técnica com FFT e Históricos de Vibração
│   │   └── Manutencao.jsx      # Gestão de Planos e Ordens de Serviço
│   ├── services/
│   │   └── api.js              # Chamadas Axios/Fetch para o Back-end
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── README.md
Funcionalidades das Telas Principais
Dashboard Geral (Monitoramento Online):

Grade de compressores mostrando status (Operando em verde, Falha em vermelho, Manutenção em amarelo).

Exibição do tempo de trabalho acumulado (Horímetro total) e barra de progresso para a próxima preventiva.

Indicador visual se o compressor está trabalhando "Em Carga" ou "Em Vazio".

Módulo de Mecânica e Vibração:

Gráfico de linha dinâmico atualizado a cada segundo via WebSocket mostrando o valor RMS da vibração.

Linhas horizontais vermelhas e amarelas indicando limites de Alerta e Crítico conforme normas ISO (ex: ISO 10816).

Painel de análise de espectro (FFT) para analistas de preditiva identificarem desalinhamento ou folgas.

Painel de Manutenção Preventiva:

Lista de tarefas preventivas com semáforo de criticidade:

Verde: Longe do prazo.

Amarelo: Dentro de 10% do limite de horas (Ex: 1900h de um plano de 2000h) ou 15 dias do prazo calendário.

Vermelho: Prazo de preventiva estourado.

Botão para dar baixa na preventiva executada, o que recalcula automaticamente os próximos gatilhos no SQL.

5. Lógica de Automação de Manutenção Preventiva (Regra de Negócio)
Para garantir que a manutenção preventiva seja acionada corretamente, o Back-end executa uma rotina inteligente (Job diário ou evento disparado por atualização de horímetro):

JavaScript
// Exemplo conceitual da lógica implementada no Back-end (services/manutencao.service.js)
async function verificarGatilhosPreventivos(compressorId, horasAtuais) {
    // 1. Busca os planos ativos do compressor
    const planos = await db('planos_preventiva').where({ compressor_id: compressorId });
    const dataAtual = new Date();

    for (let plano of planos) {
        let dispararAlerta = false;
        let motivo = "";

        // Verificação por Horas de Trabalho
        if (horasAtuais >= plano.proxima_revisao_horas) {
            dispararAlerta = true;
            motivo = `Horímetro atingiu ${horasAtuais}h (Limite do plano: ${plano.proxima_revisao_horas}h)`;
        }
        
        // Verificação por Tempo Calendário
        if (dataAtual >= new Date(plano.proxima_revisao_data)) {
            dispararAlerta = true;
            motivo = `Data limite atingida: ${plano.proxima_revisao_data.toLocaleDateString()}`;
        }

        // Se algum gatilho estourou, gera a Ordem de Serviço Preventiva automaticamente
        if (dispararAlerta) {
            await db('ordens_manutencao').insert({
                compressor_id: compressorId,
                plano_id: plano.id,
                tipo: 'preventiva',
                status: 'aberta',
                descricao_problema: `Gerado Automaticamente pelo Sistema. Motivo: ${motivo}`
            });
            
            // Emite notificação em tempo real via WebSocket para o Front-end
            io.emit('alerta:manutencao', { compressorId, mensagem: `Preventiva Necessária: ${plano.descricao}` });
        }
    }
}
Este projeto garante o rastreamento ponta a ponta, unindo a velocidade do tempo real necessária para a análise mecânica de vibração com a consistência relacional exigida pela gestão de manutenção industrial.


file_name = "projeto_sistema_compressor.md"
with open(file_name, "w", encoding="utf-8") as f:
f.write(markdown_content)

print(f"File created successfully: {file_name}")





'Resumo do que está estruturado e detalhado dentro do arquivo gerado:'

1. **Desenho da Arquitetura Geral:** Explicando o fluxo de dados desde a coleta simulada do sensor/IoT, passando pela API Node.js com WebSockets (Socket.io) até a renderização no Front-end.
2. **Modelagem de Banco de Dados SQL Completa:** Com scripts prontos para criação das tabelas no PostgreSQL/MySQL. As tabelas incluem:
   * `compressores` (dados mestre do ativo e limites toleráveis de vibração RMS).
   * `sensores` (controle de calibração, modelos e status de saúde do sensor).
   * `leituras_sensores` (telemetria em tempo real guardando vibração RMS, espectro FFT, temperatura e pressão).
   * `registro_trabalho` (histórico de horas que calcula dinamicamente o horímetro separando estados em "carga" e "vazio").
   * `planos_preventiva` e `ordens_manutencao` (automação das manutenções baseada em horas ou data calendário).
3. **Estrutura de Diretórios para o Back-end (Node.js):** Proposta de organização limpa separando Rotas, Controllers, Services (onde rodam os algoritmos de alertas mecânicos), Jobs (cronogramas de verificação) e WebSockets.
4. **Estrutura de Diretórios para o Front-end (React/Vue/JS Moderno):** Arquitetura baseada em componentes focados na renderização de gráficos dinâmicos de linha do tempo para vibração, e semáforos visuais (verde, amarelo e vermelho) para o status das manutenções preventivas.
5. **Lógica em Código Javascript (Exemplo de Regra de Negócio):** Um trecho prático mostrando como o Back-end cruza a telemetria do horímetro com o plano preventivo para gerar automaticamente uma Ordem de Serviço preventiva no banco de dados e notificar a equipe em tempo real.

