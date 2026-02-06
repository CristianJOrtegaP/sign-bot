# AC FIXBOT

**Chatbot de WhatsApp para gestión de reportes de servicio y encuestas de satisfacción.**

AC FIXBOT recibe reportes de fallas (refrigeradores comerciales y vehículos de flota) vía WhatsApp, los procesa con IA para extraer datos estructurados, y los enruta al centro de servicio más cercano. Después de la resolución, envía encuestas de satisfacción automatizadas.

Diseñado para **~3,000 reportes/mes** con consistencia transaccional garantizada mediante bloqueo optimista (`Version++`) en SQL Server.

> **Versión actual:** 2.1.0 | **Schema DB:** 5.4 | **Runtime:** Node.js 20 LTS

---

## Stack Tecnológico

| Capa                | Tecnología                                      | Propósito                                                 |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| **Runtime**         | Node.js 20 LTS                                  | Azure Functions v4                                        |
| **Mensajería**      | Meta Graph API v22.0                            | WhatsApp Business Platform                                |
| **IA — Intención**  | Azure OpenAI (`gpt-4o-mini`) / Gemini 2.5 Flash | Detección de intención, extracción de datos estructurados |
| **IA — Visión**     | Azure Computer Vision                           | OCR de etiquetas SAP y códigos de barras                  |
| **IA — Audio**      | Azure Whisper → Azure Speech (fallback)         | Transcripción de notas de voz (español)                   |
| **Base de datos**   | Azure SQL Server                                | Persistencia con bloqueo optimista + stored procedures    |
| **Cache**           | Azure Cache for Redis (TLS:6380) + Map local    | Sesiones (5 min), equipos (15 min), intenciones (5 min)   |
| **Almacenamiento**  | Azure Blob Storage                              | Imágenes comprimidas de reportes                          |
| **Geocodificación** | Azure Maps                                      | Cálculo Haversine → centro de servicio más cercano        |
| **Monitoreo**       | Application Insights                            | Tracing distribuido W3C + métricas custom                 |
| **Error Recovery**  | Dead Letter Queue (SQL)                         | Reintentos automáticos de mensajes fallidos               |

---

## Arquitectura de Alto Nivel

```
┌──────────────┐          ┌──────────────────────────────┐          ┌──────────────┐
│              │  HTTPS   │      Azure Functions v4       │          │  Azure SQL   │
│   WhatsApp   │─────────▶│                               │────────▶│   Server     │
│   (Meta)     │◀─────────│  HTTP Triggers:                │          │  (db-acfixbot)│
│              │          │   • api-whatsapp-webhook       │          └──────┬───────┘
└──────────────┘          │   • api-health                 │                 │
                          │   • api-admin/{action}         │          ┌──────┴───────┐
                          │   • api-conversations          │          │ Azure Redis  │
                          │                               │          │ Cache (TLS)  │
                          │  Timer Triggers:               │          └──────────────┘
                          │   • session-cleanup (*/5 min)  │
                          │   • survey-sender  (9 AM)      │          ┌──────────────┐
                          │   • dlq-processor              │          │  Blob Storage│
                          └──────────────┬────────────────┘          └──────────────┘
                                         │
                          ┌──────────────┴────────────────┐
                          │  Azure OpenAI / Gemini         │
                          │  Computer Vision (OCR)         │
                          │  Azure Maps (geocoding)        │
                          │  Azure Speech (audio fallback) │
                          └───────────────────────────────┘
```

---

## Estructura del Proyecto

```
acfixbot/
│
├── api-whatsapp-webhook/              # Webhook principal de Meta (HTTP POST/GET)
├── api-health/                        # Health check con diagnósticos de conectividad
├── api-admin/                         # API admin: cache, métricas, tickets (Function Key auth)
├── api-conversations/                 # Historial de conversaciones por teléfono
│
├── timer-session-cleanup/             # Cierre de sesiones inactivas (cada 5 min)
├── timer-survey-sender/               # Envío de encuestas post-resolución (9:00 AM)
├── timer-dlq-processor/               # Reprocesamiento de Dead Letter Queue
│
├── bot/
│   ├── controllers/
│   │   ├── messageHandler/            # Router principal por tipo de mensaje
│   │   │   ├── handlers/textHandler.js    # Texto → detección de intención → flujo
│   │   │   ├── handlers/buttonHandler.js  # Botones interactivos (StaticFlowRegistry)
│   │   │   └── handlers/locationHandler.js # Ubicación GPS → centro de servicio
│   │   ├── imageHandler.js            # OCR + AI Vision + background compression
│   │   └── audioHandler.js            # Whisper → Speech → texto
│   ├── flows/
│   │   ├── reporteFlow.js             # Flujo flexible: refrigerador y vehículo
│   │   ├── encuestaFlow.js            # Encuesta de satisfacción (6 preguntas + comentario)
│   │   ├── consultaFlow.js            # Consulta de estado de ticket
│   │   └── index.js                   # Registro de flujos en StaticFlowRegistry
│   ├── repositories/                  # Capa de acceso a datos (SQL + cache)
│   │   ├── BaseRepository.js          # Connection pool + cache TTL + reintentos
│   │   ├── SesionRepository.js        # Sesiones con bloqueo optimista (Version)
│   │   ├── ReporteRepository.js       # Creación de reportes (refrigerador/vehículo)
│   │   ├── EquipoRepository.js        # Equipos SAP con cache (15 min)
│   │   └── EncuestaRepository.js      # Encuestas y respuestas
│   ├── services/                      # Lógica de negocio
│   └── constants/                     # Estados de sesión, mensajes del bot
│
├── core/
│   ├── config/index.js                # Configuración centralizada + validación de env vars
│   ├── flowEngine/
│   │   ├── contexts/BaseContext.js         # Métodos base: responder, cambiarEstado, finalizar
│   │   ├── contexts/FlexibleFlowContext.js # Campos en cualquier orden + validación
│   │   ├── StaticFlowRegistry.js           # Registro de flujos estáticos (encuesta, consulta)
│   │   └── index.js                        # Exports del engine
│   ├── services/
│   │   ├── ai/
│   │   │   ├── aiService.js               # Abstracción multi-provider (Gemini/Azure)
│   │   │   ├── intentService.js           # 3-tier: cache → regex → IA
│   │   │   ├── audioTranscriptionService.js # Multi-provider con fallback
│   │   │   └── providers/
│   │   │       ├── azureOpenAIProvider.js  # SDK openai v6 + token logging
│   │   │       ├── geminiProvider.js       # Google Generative AI
│   │   │       └── prompts.js             # System prompts (intención, extracción)
│   │   ├── cache/redisService.js          # Redis con fallback automático a Map local
│   │   ├── external/whatsappService.js    # Meta Graph API v22.0 + circuit breaker
│   │   ├── infrastructure/                # Logger, métricas, seguridad, circuit breaker
│   │   ├── processing/                    # Background processor, session timeout
│   │   └── storage/                       # Connection pool (SQL), blob, database service
│   └── middleware/                        # Rate limiting, security headers
│
├── sql-scripts/
│   └── install-full-database.sql          # Schema completo v5.4 (idempotente)
├── docs/                                  # Documentación técnica
└── tests/                                 # Jest: unit, integration, e2e
```

---

## Prerequisitos

| Componente                 | Versión                  | Notas                                                 |
| -------------------------- | ------------------------ | ----------------------------------------------------- |
| Node.js                    | >= 20 LTS                | Runtime de Azure Functions v4                         |
| Azure Functions Core Tools | v4                       | `npm i -g azure-functions-core-tools@4`               |
| SQL Server                 | Azure SQL o Docker local | Schema v5.4                                           |
| Redis                      | Azure Cache for Redis    | **Opcional** — fallback automático a cache en memoria |
| Meta Business Account      | —                        | WhatsApp Business API configurada                     |
| Azure OpenAI               | `gpt-4o-mini` deployment | O Gemini API Key para desarrollo local                |

---

## Guía Rápida de Despliegue

### 1. Instalar dependencias

```bash
git clone <repo-url> && cd acfixbot
npm install
```

### 2. Instalar base de datos

```bash
# El script es idempotente: crea tablas, índices, SPs y datos de catálogo
sqlcmd -S <server> -d db-acfixbot -U <user> -P <password> \
  -i sql-scripts/install-full-database.sql
```

**Tablas principales creadas:**

| Tabla                 | Propósito                                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| `SesionesChat`        | Estado de conversación por teléfono (con `Version` para bloqueo optimista) |
| `Reportes`            | Tickets de falla — refrigerador o vehículo (formato `TKT-XXXXXXXX`)        |
| `Equipos`             | Catálogo de equipos con código SAP y código de barras                      |
| `Clientes`            | Catálogo de clientes vinculados a equipos                                  |
| `CentrosServicio`     | Centros de servicio con coordenadas (Haversine)                            |
| `Encuestas`           | Encuestas de satisfacción post-resolución                                  |
| `RespuestasEncuesta`  | Respuestas individuales (escala 1-5)                                       |
| `MensajesProcessados` | Deduplicación atómica (`MERGE`)                                            |
| `DeadLetterMessages`  | Cola de errores para reintento automático                                  |
| `HistorialSesiones`   | Auditoría de cambios de estado                                             |
| `MensajesChat`        | Historial completo de conversación                                         |

### 3. Configurar variables de entorno

Crear `local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",

    "SQL_CONNECTION_STRING": "Server=tcp:srv.database.windows.net,1433;Database=db-acfixbot;User Id=...;Password=...;Encrypt=true",

    "WHATSAPP_TOKEN": "<Meta Graph API access token>",
    "WHATSAPP_PHONE_ID": "<Phone Number ID>",
    "WHATSAPP_VERIFY_TOKEN": "<webhook verification token>",
    "WHATSAPP_APP_SECRET": "<App Secret para HMAC-SHA256>",

    "USE_AI": "true",
    "AI_PROVIDER": "azure-openai",
    "AZURE_OPENAI_ENDPOINT": "https://<resource>.openai.azure.com",
    "AZURE_OPENAI_KEY": "<key>",
    "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-mini"
  }
}
```

### 4. Ejecutar localmente

```bash
# Iniciar Azure Functions
func start

# O con npm
npm start
```

### 5. Configurar Webhook en Meta

1. Meta Developers → WhatsApp → Configuration
2. **Callback URL:** `https://<function-app>.azurewebsites.net/api/whatsapp-webhook`
3. **Verify Token:** valor de `WHATSAPP_VERIFY_TOKEN`
4. **Suscripciones:** `messages`

---

## Variables de Entorno

### Requeridas (el sistema no arranca sin estas)

| Variable                | Descripción                                      |
| ----------------------- | ------------------------------------------------ |
| `SQL_CONNECTION_STRING` | Connection string a Azure SQL / SQL Server       |
| `WHATSAPP_TOKEN`        | Token de acceso de Meta Graph API                |
| `WHATSAPP_PHONE_ID`     | Phone Number ID de WhatsApp Business             |
| `WHATSAPP_VERIFY_TOKEN` | Token para handshake de verificación del webhook |

### IA y Procesamiento

| Variable                      | Descripción                                         | Default             |
| ----------------------------- | --------------------------------------------------- | ------------------- |
| `USE_AI`                      | Habilitar servicios de IA                           | `true`              |
| `AI_PROVIDER`                 | `azure-openai` (producción) o `gemini` (desarrollo) | `gemini`            |
| `AZURE_OPENAI_ENDPOINT`       | Endpoint del recurso Azure OpenAI                   | —                   |
| `AZURE_OPENAI_KEY`            | API Key                                             | —                   |
| `AZURE_OPENAI_DEPLOYMENT`     | Nombre del deployment                               | `gpt-4o-mini`       |
| `GEMINI_API_KEY`              | API Key de Google Gemini                            | —                   |
| `VISION_ENDPOINT`             | Azure Computer Vision endpoint                      | —                   |
| `VISION_KEY`                  | API Key de Computer Vision                          | —                   |
| `AUDIO_TRANSCRIPTION_ENABLED` | Habilitar transcripción de notas de voz             | `true`              |
| `AZURE_AUDIO_DEPLOYMENT`      | Deployment de Whisper en Azure OpenAI               | `gpt-4o-mini-audio` |
| `AZURE_SPEECH_KEY`            | Azure Speech Services (fallback audio)              | —                   |
| `AZURE_SPEECH_REGION`         | Región de Speech Services                           | `eastus`            |

### Cache y Almacenamiento

| Variable                 | Descripción                                 | Default     |
| ------------------------ | ------------------------------------------- | ----------- |
| `REDIS_ENABLED`          | Habilitar cache distribuido                 | `false`     |
| `REDIS_HOST`             | Host de Azure Cache for Redis               | —           |
| `REDIS_PORT`             | Puerto (TLS requerido en Azure)             | `6380`      |
| `REDIS_PASSWORD`         | Access Key                                  | —           |
| `REDIS_KEY_PREFIX`       | Prefijo para evitar colisiones multi-tenant | `acfixbot:` |
| `BLOB_CONNECTION_STRING` | Connection string de Azure Blob Storage     | —           |

### Sesiones y Encuestas

| Variable                  | Descripción                                      | Default         |
| ------------------------- | ------------------------------------------------ | --------------- |
| `SESSION_TIMEOUT_MINUTES` | Minutos de inactividad antes de cerrar sesión    | `30`            |
| `SESSION_WARNING_MINUTES` | Minutos antes del cierre para enviar aviso       | `25`            |
| `TIMER_SCHEDULE`          | CRON del timer de cleanup                        | `0 */5 * * * *` |
| `SURVEY_TIMER_SCHEDULE`   | CRON del envío de encuestas                      | `0 0 9 * * *`   |
| `SURVEY_HORAS_ESPERA`     | Horas post-resolución antes de enviar encuesta   | `24`            |
| `SURVEY_HORAS_EXPIRACION` | Horas para que expire una encuesta sin responder | `72`            |
| `SURVEY_HORA_INICIO`      | Hora inicio de ventana de envío                  | `8`             |
| `SURVEY_HORA_FIN`         | Hora fin de ventana de envío                     | `20`            |
| `TIMEZONE_OFFSET_HOURS`   | Offset UTC (México Central)                      | `-6`            |

### Seguridad y Geocodificación

| Variable                    | Descripción                                      | Default |
| --------------------------- | ------------------------------------------------ | ------- |
| `WHATSAPP_APP_SECRET`       | App Secret de Meta para verificación HMAC-SHA256 | —       |
| `SKIP_SIGNATURE_VALIDATION` | Bypass de firma (**solo desarrollo local**)      | `false` |
| `ADMIN_RATE_LIMIT_MAX`      | Requests por minuto al API admin                 | `60`    |
| `AZURE_MAPS_KEY`            | API Key de Azure Maps                            | —       |
| `ROUTE_BUFFER_MINUTES`      | Buffer adicional en cálculo de ETA               | `20`    |

> La validación de variables se ejecuta al arrancar (`config/index.js`). Si falta una variable requerida, el sistema lanza un error inmediato.

---

## Flujos Conversacionales

### Reporte de Refrigerador (flujo flexible)

```
Usuario: "El refrigerador no enfría"
   Bot: Detecta intención REPORTAR_FALLA → pregunta tipo
Usuario: "Refrigerador"
   Bot: Solicita código SAP (texto o foto de etiqueta)
Usuario: [Envía foto de la etiqueta]
   Bot: OCR extrae código SAP → busca equipo en BD → confirma datos
Usuario: "Sí, es correcto"
   Bot: Solicita descripción del problema
Usuario: "No enfría y hace ruido"
   Bot: Extrae datos con IA → solicita foto del equipo
Usuario: [Envía foto]
   Bot: Comprime → sube a Blob → genera ticket TKT-XXXXXXXX
```

### Reporte de Vehículo (flujo flexible)

```
Usuario: "Mi camión no arranca"
   Bot: Detecta intención → solicita número de empleado
Usuario: "12345"
   Bot: Solicita código SAP del vehículo
Usuario: "1234567"
   Bot: Solicita ubicación GPS
Usuario: [Envía ubicación]
   Bot: Azure Maps → calcula centro de servicio más cercano → genera ticket
```

### Encuesta de Satisfacción (flujo estático)

```
[24h después de resolución — 9:00 AM]
   Bot: "¿Podrías ayudarnos con una breve encuesta?"
Usuario: [Acepta]
   Bot: 6 preguntas en escala 1-5 (botones interactivos)
Usuario: Responde cada pregunta
   Bot: "¿Algún comentario adicional?"
Usuario: "Todo bien" / [Salta]
   Bot: Agradece y cierra encuesta
```

---

## Tests

```bash
# Ejecutar todos los tests
npm test

# Con cobertura
npm run test:coverage

# Archivo específico
npx jest tests/unit/FlowManager.test.js
```

---

## Documentación Técnica

| Documento                                           | Audiencia    | Contenido                                                                                         |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**         | Senior Devs  | Flujo de datos completo, máquina de estados, bloqueo optimista, capas de cache, diagramas Mermaid |
| **[API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md)** | Devs / QA    | Meta Graph API, Azure OpenAI, Vision OCR, Audio, Azure Maps, API admin                            |
| **[OPERATIONS.md](docs/OPERATIONS.md)**             | SRE / DevOps | Timers, monitoreo con KQL en App Insights, DLQ, procedimientos de recuperación                    |

---

## Licencia

Proyecto privado — AC Servicios. Todos los derechos reservados.
