# Banco de dados Compressor - SENAI

Endpoints principais da API REST (/api/v1)
`GET /compressores` 
`GET /compressores/:id/dashboard`  -> Dados consolidados das últimas 24h (médias de vibração, alarmes).
`GET /compressores/:id/vibracao-historico` -> Dados brutos e FFT para gráficos de engenharia preditiva.
`POST /manutencao/ordens` -> Abertura manual ou automática de ordens de serviço.
`GET /manutencao/preventivas-pendentes` -> Lista o que está próximo do gatilho de horas/tempo.
`POST /sensores/calibracao` -> Atualiza a data de calibração do sensor.



# Parâmetros do Banco de Dados - Monitoramento de Compressores

## 1. Tabela: `compressores`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| tag | string | sim |
| modelo | string | sim |
| fabricante | string | não |
| data_instalacao | date | sim |
| status | string | não |
| limite_vibracao_alerta | float | não |
| limite_vibracao_critico | float | não |
| criado_em | timestamp | não |

---

## 2. Tabela: `sensores`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| compressor_id | integer | não |
| codigo_sensor | string | sim |
| tipo | string | sim |
| modelo | string | não |
| data_ultima_calibracao | date | não |
| status | string | não |

---

## 3. Tabela: `leituras_sensores`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| sensor_id | integer | não |
| compressor_id | integer | não |
| valor_rms | float | sim |
| valor_fft | string | não |
| temperatura | float | não |
| pressao | float | não |
| timestamp | timestamp | sim |

---

## 4. Tabela: `registro_trabalho`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| compressor_id | integer | não |
| tipo_estado | string | sim |
| data_inicio | timestamp | sim |
| data_fim | timestamp | não |
| horas_calculadas | float | não |

---

## 5. Tabela: `planos_preventiva`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| compressor_id | integer | não |
| descricao | string | sim |
| intervalo_horas | integer | sim |
| intervalo_meses | intege | sim |
| proxima_revisao_horas | integer | sim |
| proxima_revisao_data | date | sim |

---

## 6. Tabela: `ordens_manutencao`

| Nome | Tipo | Obrigatório |
|------|------|-------------|
| id | integer | sim |
| compressor_id | integer | não |
| plano_id | integer | não |
| tipo | string | sim |
| status | string | não |
| descricao_problema | string | não |
| acoes_executadas | string | não |
| data_abertura | timestamp | não |
| data_conclusao | timestamp | não |
| tecnico_responsavel | string | não |

## Resposta

```
{
  "id": 1,
  "tag": "COMP-01",
  "periodo": "24h",
  "vibracao_media_rms": 3.8,
  "temperatura_media": 72.5,
  "total_alertas": 2,
  "status_atual": "operando"
}
```


# Documentação da API REST - Monitoramento de Compressores

**Base URL:** `/api/v1`

---

## 📡 Endpoints Principais

### 1. Listar Compressores
- **Método:** `GET`
- **Rota:** `/compressores`
- **Descrição:** Retorna a listagem de todos os compressores cadastrados no sistema.

#### Resposta (200 OK)
```json
[
  {
    "id": 1,
    "tag": "COMP-01",
    "modelo": "Atlas Copco GA37",
    "status": "operando"
  }
]
```

---

### 2. Dashboard do Compressor
- **Método:** `GET`
- **Rota:** `/compressores/:id/dashboard`
- **Descrição:** Retorna dados consolidados das últimas 24 horas (médias de vibração, temperatura e alarmes disparados).

#### Parâmetros de Rota
| Nome | Tipo | Obrigatório | Descrição |
|------|------|-------------|-----------|
| `id` | integer | sim | Identificador único do compressor |

#### Resposta (200 OK)
```json
{
  "id": 1,
  "tag": "COMP-01",
  "periodo": "24h",
  "vibracao_media_rms": 3.8,
  "temperatura_media": 72.5,
  "total_alertas": 2,
  "status_atual": "operando"
}
```

---

### 3. Histórico de Vibração e FFT
- **Método:** `GET`
- **Rota:** `/compressores/:id/vibracao-historico`
- **Descrição:** Retorna dados brutos e espectro FFT para geração de gráficos de engenharia preditiva.

#### Parâmetros de Rota
| Nome | Tipo | Obrigatório | Descrição |
|------|------|-------------|-----------|
| `id` | integer | sim | Identificador único do compressor |

#### Resposta (200 OK)
```json
{
  "compressor_id": 1,
  "leituras": [
    {
      "timestamp": "2026-08-06T12:00:00Z",
      "valor_rms": 4.2,
      "fft": [0.1, 0.4, 1.2, 0.8, 0.2]
    }
  ]
}
```

---

### 4. Abertura de Ordem de Serviço
- **Método:** `POST`
- **Rota:** `/manutencao/ordens`
- **Descrição:** Abertura manual ou automática de ordens de serviço.

#### Parâmetros do Corpo (Payload)
| Nome | Tipo | Obrigatório | Descrição |
|------|------|-------------|-----------|
| `compressor_id` | integer | sim | ID do compressor |
| `plano_id` | integer | não | ID do plano de manutenção associado |
| `tipo` | string | sim | Tipo: `preventiva`, `corretiva` ou `preditiva` |
| `descricao_problema` | string | sim | Descrição detalhada da ocorrência |

#### Resposta (201 Created)
```json
{
  "id": "123",
  "status": "ok"
}
```

---

### 5. Manutenções Preventivas Pendentes
- **Método:** `GET`
- **Rota:** `/manutencao/preventivas-pendentes`
- **Descrição:** Lista o que está próximo ou venceu o gatilho de horas/tempo para revisão.

#### Resposta (200 OK)
```json
[
  {
    "plano_id": 5,
    "compressor_tag": "COMP-01",
    "descricao": "Troca do filtro de óleo",
    "proxima_revisao_horas": 2000,
    "proxima_revisao_data": "2026-08-15",
    "status": "pendente"
  }
]
```

---

### 6. Atualização de Calibração de Sensor
- **Método:** `POST`
- **Rota:** `/sensores/calibracao`
- **Descrição:** Atualiza a data de calibração e o status operacional do sensor.

#### Parâmetros do Corpo (Payload)
| Nome | Tipo | Obrigatório | Descrição |
|------|------|-------------|-----------|
| `codigo_sensor` | string | sim | Código identificador (Ex: `SEN-VIB-01`) |
| `data_calibracao` | date | sim | Data da realização da calibração |
| `status` | string | não | Status: `ativo`, `defeito`, `descalibrado` |

#### Resposta (200 OK)
```json
{
  "id": "123",
  "status": "ok"
}
```

---

## 📋 Tabela Resumo da API REST (`/api/v1`)

| Método | Rota | Descrição | Resposta Padrão |
|--------|------|-----------|-----------------|
| `GET` | `/compressores` | Lista todos os compressores | Array de objetos |
| `GET` | `/compressores/:id/dashboard` | Dados consolidados das últimas 24h | Dados de telemetria/alarmes |
| `GET` | `/compressores/:id/vibracao-historico` | Dados brutos e FFT para análise preditiva | Histórico espectral |
| `POST` | `/manutencao/ordens` | Abertura manual ou automática de O.S. | `{"id": "123", "status": "ok"}` |
| `GET` | `/manutencao/preventivas-pendentes` | Lista revisões próximas do gatilho | Array de preventivas |
| `POST` | `/sensores/calibracao` | Atualiza data de calibração do sensor | `{"id": "123", "status": "ok"}` |