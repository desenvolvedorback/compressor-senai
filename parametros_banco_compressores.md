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
| intervalo_meses | integer | sim |
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