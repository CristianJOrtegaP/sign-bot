# AC FIXBOT - Prompt Inicial para Contexto Rápido

## Descripción General
**AC FixBot** es un chatbot de WhatsApp desarrollado para **Arca Continental** que permite reportar fallas de equipos (refrigeradores y vehículos), consultar estado de tickets y responder encuestas de satisfacción a través de conversaciones naturales. El sistema está implementado con **Azure Functions** (serverless) y utiliza IA (Google Gemini o Azure OpenAI) para procesamiento inteligente de lenguaje natural.

## Stack Tecnológico
- **Backend**: Node.js con Azure Functions (serverless)
- **IA/NLP**: Google Gemini 2.5 Flash API o Azure OpenAI (configurable)
- **Visión por computadora**: Azure Computer Vision (OCR para códigos de barras)
- **Base de datos**: Azure SQL Database
- **Mensajería**: WhatsApp Business API (Meta) v22.0
- **Storage**: Azure Blob Storage (imágenes)
- **Costo aproximado**: ~$30-35 USD/mes (100 reportes/día)

## Estructura de Carpetas
```
acfixbot-poc/
├── functions/                       # Azure Functions (serverless)
│   ├── api-whatsapp-webhook/        # Webhook principal de WhatsApp
│   │   ├── index.js                 # GET (verificacion) y POST (mensajes)
│   │   └── function.json            # Configuracion HTTP trigger
│   ├── api-ticket-resolve/          # API para resolver tickets
│   │   ├── index.js                 # POST /api/resolveTicket
│   │   └── function.json            # HTTP trigger (function level auth)
│   ├── api-admin-cache/             # API administrativa de cache
│   │   ├── index.js                 # Limpia cache y estadisticas
│   │   └── function.json            # HTTP trigger
│   ├── api-health/                  # Health check endpoint
│   │   ├── index.js                 # GET /api/health
│   │   └── function.json            # HTTP trigger (anonymous)
│   ├── timer-session-cleanup/       # Timer para sesiones
│   │   ├── index.js                 # Cierra sesiones inactivas
│   │   └── function.json            # Timer trigger (CRON)
│   └── timer-survey-sender/         # Timer para encuestas
│       ├── index.js                 # Envia encuestas de satisfaccion
│       └── function.json            # Timer trigger (CRON)
├── config/                          # Configuracion centralizada
│   └── index.js                     # Constantes y variables de entorno
├── constants/                       # Constantes y enums
│   ├── sessionStates.js             # Estados de sesion, tipos de reporte
│   └── messages.js                  # Templates de mensajes y botones
├── controllers/                     # Manejadores de logica de negocio
│   ├── messageHandler.js            # Procesa mensajes de texto y botones
│   ├── imageHandler.js              # Procesa imagenes (codigos de barras)
│   └── flows/                       # Flujos de conversacion
│       ├── FlowManager.js           # Orquestador central de flujos
│       ├── refrigeradorFlow.js      # Flujo de reporte de refrigerador
│       ├── vehiculoFlow.js          # Flujo de reporte de vehiculo
│       ├── consultaEstadoFlow.js    # Flujo de consulta de tickets
│       └── encuestaFlow.js          # Flujo de encuestas de satisfaccion
├── errors/                          # Clases de error personalizadas
│   ├── index.js                     # Exporta todos los errores
│   ├── AppError.js                  # Clase base de errores
│   ├── DatabaseError.js             # Error de base de datos
│   ├── ValidationError.js           # Error de validacion
│   ├── ExternalServiceError.js      # Error de servicio externo
│   └── ...                          # Otros errores especializados
├── middleware/                      # Middleware reutilizable
│   ├── index.js                     # Exporta todo el middleware
│   ├── deduplication.js             # Prevencion de duplicados
│   ├── rateLimitMiddleware.js       # Control de rate limiting
│   └── sanitization.js              # Sanitizacion de datos
├── schemas/                         # Validacion con Zod
│   ├── index.js                     # Exporta todos los schemas
│   ├── webhookPayload.js            # Schema de webhook WhatsApp
│   ├── ticketResolvePayload.js      # Schema de resolver ticket
│   └── reportePayload.js            # Schema de reportes
├── repositories/                    # Capa de acceso a datos (DAL)
│   ├── index.js                     # Exporta todos los repositorios
│   ├── BaseRepository.js            # Clase base con cache
│   ├── SesionRepository.js          # CRUD de sesiones
│   ├── EquipoRepository.js          # Consulta de equipos
│   ├── ReporteRepository.js         # CRUD de reportes
│   └── EncuestaRepository.js        # Gestion de encuestas
├── services/                        # Servicios reutilizables
│   ├── index.js                     # Barrel file - exporta todo
│   ├── ai/                          # Servicios de IA
│   │   ├── aiService.js             # Orquestador de proveedores
│   │   ├── intentService.js         # Deteccion de intenciones
│   │   ├── visionService.js         # OCR con Azure Vision
│   │   └── providers/               # Proveedores de IA
│   │       ├── geminiProvider.js    # Google Gemini
│   │       └── azureOpenAIProvider.js # Azure OpenAI
│   ├── core/                        # Servicios transversales
│   │   ├── rateLimiter.js           # Rate limiting y deduplicacion
│   │   ├── errorHandler.js          # Logger y manejo de errores
│   │   └── metricsService.js        # Metricas de rendimiento
│   ├── external/                    # Integraciones externas
│   │   └── whatsappService.js       # API de WhatsApp
│   ├── storage/                     # Persistencia
│   │   ├── databaseService.js       # Facade sobre repositorios
│   │   ├── connectionPool.js        # Pool de conexiones MSSQL
│   │   └── blobService.js           # Azure Blob Storage
│   └── processing/                  # Procesamiento background
│       ├── backgroundProcessor.js   # Procesamiento asincrono
│       ├── sessionTimeoutService.js # Timeouts de sesiones
│       └── imageProcessor.js        # Compresion de imagenes
├── utils/                           # Utilidades
│   └── helpers.js                   # Funciones auxiliares
├── tests/                           # Suite de pruebas Jest
│   ├── unit/                        # Tests unitarios
│   ├── flows/                       # Tests de flujos
│   ├── integration/                 # Tests de integracion
│   ├── fixtures/                    # Datos de prueba reutilizables
│   │   ├── webhookPayloads.js       # Payloads de WhatsApp mock
│   │   └── mockSessions.js          # Sesiones mock
│   ├── helpers/                     # Utilidades de test
│   │   └── testFactory.js           # Factory de mocks
│   └── __mocks__/                   # Mocks de Jest
├── sql-scripts/                     # Scripts de base de datos
├── scripts/                         # Scripts de utilidad
├── docs/                            # Documentacion tecnica
├── host.json                        # Configuracion Azure Functions
└── package.json                     # Dependencias y scripts
```

## Azure Functions

Todas las functions estan organizadas en la carpeta `functions/` con prefijos descriptivos:
- `api-*` para HTTP triggers
- `timer-*` para timer triggers

### 1. api-whatsapp-webhook (HTTP Trigger)
- **Ruta**: `GET/POST /api/api-whatsapp-webhook`
- **Responsabilidad**: Webhook principal de WhatsApp
  - `GET` - Verificacion de webhook (Meta challenge)
  - `POST` - Recibir mensajes, imagenes, botones, ubicaciones

### 2. api-ticket-resolve (HTTP Trigger - Function Level Auth)
- **Ruta**: `POST /api/api-ticket-resolve`
- **Responsabilidad**: API externa para resolver tickets
- **Payload**: `{ "ticketId": "TKT..." }`

### 3. api-admin-cache (HTTP Trigger)
- **Ruta**: `GET/POST /api/api-admin-cache`
- **Responsabilidad**: Administracion de cache
- **Parametros**: `type=equipos|sesiones|all|stats|trigger_timeout`

### 4. api-health (HTTP Trigger - Anonymous)
- **Ruta**: `GET /api/api-health`
- **Responsabilidad**: Health check del sistema
- **Verifica**: Base de datos, configuracion, memoria, uptime

### 5. timer-session-cleanup (Timer Trigger)
- **Schedule**: CRON configurable (default: cada 5 minutos)
- **Responsabilidad**:
  - Enviar advertencia "Sigues ahi?" a sesiones proximas a expirar
  - Cerrar sesiones inactivas
  - Limpiar mensajes deduplicados antiguos

### 6. timer-survey-sender (Timer Trigger)
- **Schedule**: CRON configurable (default: 9:00 AM diario)
- **Responsabilidad**:
  - Buscar reportes resueltos hace 24+ horas sin encuesta
  - Crear y enviar encuestas de satisfaccion
  - Expirar encuestas sin respuesta (72 horas)

## Estados de Sesión (Normalizados)

### Estados Terminales (Sesión Inactiva)
| Estado | ID | Descripción |
|--------|----|----|
| `INICIO` | 1 | Estado inicial, listo para nuevo flujo |
| `CANCELADO` | 2 | Usuario canceló el flujo |
| `FINALIZADO` | 3 | Flujo completado exitosamente |
| `TIMEOUT` | 4 | Sesión cerrada por inactividad |

### Estados de Flujo Refrigerador
| Estado | ID | Descripción |
|--------|----|----|
| `REFRI_ESPERA_SAP` | 5 | Esperando código SAP del refrigerador |
| `REFRI_CONFIRMAR_EQUIPO` | 6 | Esperando confirmación de datos |
| `REFRI_ESPERA_DESCRIPCION` | 7 | Esperando descripción del problema |

### Estados de Flujo Vehículo
| Estado | ID | Descripción |
|--------|----|----|
| `VEHICULO_ESPERA_EMPLEADO` | 8 | Esperando número de empleado |
| `VEHICULO_ESPERA_SAP` | 9 | Esperando código SAP del vehículo |
| `VEHICULO_ESPERA_DESCRIPCION` | 10 | Esperando descripción del problema |
| `VEHICULO_ESPERA_UBICACION` | 11 | Esperando ubicación (mapa) |

### Estados de Flujo Encuesta
| Estado | ID | Descripción |
|--------|----|----|
| `ENCUESTA_INVITACION` | 12 | Esperando aceptar/rechazar encuesta |
| `ENCUESTA_PREGUNTA_1` | 13 | Pregunta 1 de satisfacción |
| `ENCUESTA_PREGUNTA_2` | 14 | Pregunta 2 de satisfacción |
| `ENCUESTA_PREGUNTA_3` | 15 | Pregunta 3 de satisfacción |
| `ENCUESTA_PREGUNTA_4` | 16 | Pregunta 4 de satisfacción |
| `ENCUESTA_PREGUNTA_5` | 17 | Pregunta 5 de satisfacción |
| `ENCUESTA_PREGUNTA_6` | 18 | Pregunta 6 de satisfacción |
| `ENCUESTA_COMENTARIO` | 19 | Pregunta si desea dejar comentario |
| `ENCUESTA_ESPERA_COMENTARIO` | 20 | Esperando comentario de texto libre |

### Estados de Reporte
| Estado | ID | Descripción |
|--------|----|----|
| `PENDIENTE` | 1 | Reporte pendiente de asignación |
| `EN_PROCESO` | 2 | Técnico trabajando en el reporte |
| `RESUELTO` | 3 | Reporte resuelto |
| `CANCELADO` | 4 | Reporte cancelado |

## Pipeline de Procesamiento de Mensajes

```
WhatsApp Webhook (POST)
    ↓
1. Deduplicación (rateLimiter.isDuplicateMessage)
   └── Evita procesar reintentos de WhatsApp (TTL 30 min)
    ↓
2. Validación de teléfono E.164
    ↓
3. Sanitización del mensaje
    ↓
4. Rate Limiting (checkRateLimit)
   ├── 20 mensajes/minuto
   └── 100 mensajes/hora
    ↓
5. Detección de Spam
   ├── Local (rateLimiter.isSpamming) - 5+ en 10s
   └── Base de datos (db.checkSpam)
    ↓
6. Typing Indicator ("Escribiendo...")
    ↓
7. Guardar mensaje en BD
    ↓
8. Obtener sesión del usuario
   └── Si estado terminal → Reactivar a INICIO
    ↓
9. Detección de Intención (intentService)
   ├── Regex patterns (< 1ms)
   └── IA (Gemini/Azure OpenAI) para casos complejos
    ↓
10. Routing a Flujo (FlowManager)
    ├── processSessionState() - Por estado actual
    └── processButton() - Por botón presionado
    ↓
11. Ejecutar Handler del Flujo
    ├── refrigeradorFlow
    ├── vehiculoFlow
    ├── consultaEstadoFlow
    └── encuestaFlow
    ↓
12. Enviar respuesta WhatsApp
    ↓
13. Guardar mensaje del bot en BD
```

## Sistema de Intenciones

### Estrategia Híbrida (intentService.js)
1. **Regex (< 1ms)**: Patrones comunes con alta confianza (0.9)
   - SALUDO, CANCELAR, DESPEDIDA
   - REPORTAR_FALLA, TIPO_REFRIGERADOR, TIPO_VEHICULO
2. **IA (Gemini/Azure OpenAI)**: Para casos complejos
   - Extracción estructurada de datos
   - Interpretación de mensajes ambiguos

### Intenciones Detectadas
| Intención | Descripción | Acción |
|-----------|-------------|--------|
| `SALUDO` | Hola, buenos días, etc. | Mostrar menú principal |
| `REPORTAR_FALLA` | Problema con equipo | Iniciar flujo según tipo |
| `TIPO_REFRIGERADOR` | Refri, cooler, nevera | Iniciar flujo refrigerador |
| `TIPO_VEHICULO` | Carro, camión, auto | Iniciar flujo vehículo |
| `CONSULTAR_ESTADO` | Ver ticket, estado | Iniciar flujo consulta |
| `CANCELAR` | Cancelar, salir | Cancelar flujo actual |
| `DESPEDIDA` | Adiós, gracias | Reiniciar sesión |
| `OTRO` | No reconocido | Mostrar menú principal |

## Arquitectura de Capas

### 1. Controllers (Capa de Presentación)
- **messageHandler.js**: Punto de entrada para mensajes de texto y botones
- **imageHandler.js**: Punto de entrada para imágenes
- **FlowManager.js**: Orquestador que mapea estados → handlers y botones → acciones

### 2. Flows (Lógica de Negocio por Flujo)
- **refrigeradorFlow.js**: Reporte de refrigeradores
- **vehiculoFlow.js**: Reporte de vehículos con ubicación
- **consultaEstadoFlow.js**: Consulta de tickets
- **encuestaFlow.js**: Encuestas de satisfacción (6 preguntas + comentario)

### 3. Services (Servicios Transversales)
- **ai/**: Detección de intenciones, OCR, proveedores IA
- **core/**: Rate limiting, manejo de errores, métricas
- **external/**: Comunicación con WhatsApp API
- **storage/**: Acceso a BD y Blob Storage
- **processing/**: Procesamiento de imágenes, timeouts

### 4. Repositories (Capa de Datos)
- **BaseRepository.js**: Clase base con caché, TTL y reintentos
- **SesionRepository.js**: Operaciones de sesión
- **EquipoRepository.js**: Consulta de equipos por SAP
- **ReporteRepository.js**: CRUD de reportes
- **EncuestaRepository.js**: Gestión de encuestas

## Configuración Centralizada (config/index.js)

### Base de Datos
```javascript
database: {
    sessionCache: { ttlMs: 5 * 60 * 1000 },    // 5 min
    equipoCache: { ttlMs: 15 * 60 * 1000 },    // 15 min
    retry: { maxRetries: 3, backoffMultiplier: 2 }
}
```

### WhatsApp
```javascript
whatsapp: {
    apiUrl: 'https://graph.facebook.com/v22.0',
    timeout: { defaultMs: 10000, mediaDownloadMs: 30000 },
    limits: { buttonTitleMaxLength: 20 },
    retries: 2 // con exponential backoff
}
```

### IA (Configurable)
```javascript
ai: {
    provider: process.env.AI_PROVIDER || 'gemini', // 'gemini' o 'azure-openai'
    confidence: { high: 0.9, medium: 0.7, low: 0.5 }
}
```

### Rate Limiting
```javascript
rateLimiting: {
    messages: { maxPerMinute: 20, maxPerHour: 100 },
    images: { maxPerMinute: 3, maxPerHour: 20 },
    spam: { windowMs: 10000, maxMessagesInWindow: 5 },
    deduplication: { ttlMs: 30 * 60 * 1000 } // 30 min
}
```

### Sesiones
```javascript
session: {
    timeoutMinutes: 30,  // Configurable via env
    warningMinutes: 25,  // 5 min antes del timeout
    timerSchedule: '*/5 * * * *'  // Cada 5 minutos
}
```

### Encuestas
```javascript
survey: {
    minutosEspera: 1440,      // 24 horas después de resolver
    horasExpiracion: 72,      // 72 horas para responder
    timerSchedule: '0 9 * * *' // 9:00 AM diario
}
```

## Variables de Entorno

### Requeridas
| Variable | Descripción |
|----------|-------------|
| `SQL_CONNECTION_STRING` | Connection string de Azure SQL |
| `WHATSAPP_TOKEN` | Token de acceso de WhatsApp Business API |
| `WHATSAPP_PHONE_ID` | ID del número de teléfono de WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificación del webhook |

### Opcionales - IA
| Variable | Default | Descripción |
|----------|---------|-------------|
| `USE_AI` | false | Activar/desactivar IA |
| `AI_PROVIDER` | gemini | Proveedor: 'gemini' o 'azure-openai' |
| `GEMINI_API_KEY` | - | API Key de Google Gemini |
| `AZURE_OPENAI_ENDPOINT` | - | Endpoint de Azure OpenAI |
| `AZURE_OPENAI_KEY` | - | API Key de Azure OpenAI |
| `AZURE_OPENAI_DEPLOYMENT` | - | Nombre del deployment |

### Opcionales - Servicios Azure
| Variable | Default | Descripción |
|----------|---------|-------------|
| `VISION_ENDPOINT` | - | Endpoint de Azure Computer Vision |
| `VISION_KEY` | - | API Key de Azure Computer Vision |
| `BLOB_CONNECTION_STRING` | - | Connection string de Azure Blob Storage |

### Opcionales - Configuración
| Variable | Default | Descripción |
|----------|---------|-------------|
| `SESSION_TIMEOUT_MINUTES` | 30 | Minutos de inactividad antes de timeout |
| `SESSION_WARNING_MINUTES` | 25 | Minutos antes de enviar "¿Sigues ahí?" |
| `TIMER_SCHEDULE` | */5 * * * * | CRON del timer de timeout |
| `SURVEY_TIMER_SCHEDULE` | 0 9 * * * | CRON del timer de encuestas |
| `SURVEY_MINUTOS_ESPERA` | 1440 | Minutos después de resolver para encuesta |
| `SURVEY_HORAS_EXPIRACION` | 72 | Horas para expirar encuesta |

## Ejemplos de Conversación

### Flujo Refrigerador
```
Usuario: "El refrigerador no enfría y está tirando agua"

Bot: [Detecta: REFRIGERADOR + "no enfría y está tirando agua"]
     "Entendido. Detecté que necesitas reportar:
        • Equipo: Refrigerador
        • Problema: no enfría y está tirando agua

     Por favor, ingresa el Número SAP del refrigerador
     o envía una foto del código de barras."

[Estado: REFRI_ESPERA_SAP]

Usuario: "4045101" (o envía foto del código de barras)

Bot: [Busca en BD]
     "Refrigerador Encontrado
     • Código SAP: 4045101
     • Modelo: Top Mount
     • Cliente: Soriana Centro
     ¿Es correcto?"
     [Botones: ✅ Confirmar | 🔄 Corregir | ❌ Cancelar]

[Estado: REFRI_CONFIRMAR_EQUIPO]

Usuario: [Presiona ✅ Confirmar]

Bot: "Describe brevemente el problema:"

[Estado: REFRI_ESPERA_DESCRIPCION]

Usuario: "No enfría, gotea agua"

Bot: "✅ Reporte creado exitosamente!
     📝 Ticket: TKT1737489234567
     🧊 Refrigerador: 4045101 - Top Mount
     🔧 Problema: No enfría, gotea agua

     Un técnico te contactará pronto."

[Estado: FINALIZADO]
```

### Flujo Encuesta de Satisfacción (Automático 24h después de resolver)
```
[survey-sender-timer se ejecuta - 9:00 AM]

Bot: "¡Hola! Tu reporte TKT1737489234567 fue resuelto.
     ¿Te gustaría responder una breve encuesta de satisfacción?
     Solo tomará 1 minuto."
     [Botones: ✅ Sí, responder | ❌ No, gracias]

[Estado: ENCUESTA_INVITACION]

Usuario: [Presiona ✅ Sí, responder]

Bot: "Pregunta 1 de 6:
     ¿Qué tan satisfecho estás con el tiempo de respuesta?"
     [Botones: 1⭐ | 2⭐ | 3⭐ | 4⭐ | 5⭐]

[Estado: ENCUESTA_PREGUNTA_1]

Usuario: [Presiona 5⭐]

Bot: "Pregunta 2 de 6:
     ¿Qué tan satisfecho estás con la calidad del servicio?"
     [Botones: 1⭐ | 2⭐ | 3⭐ | 4⭐ | 5⭐]

... (continúa hasta pregunta 6)

[Estado: ENCUESTA_COMENTARIO]

Bot: "¿Deseas agregar algún comentario adicional?"
     [Botones: ✅ Sí | ❌ No]

Usuario: [Presiona ✅ Sí]

[Estado: ENCUESTA_ESPERA_COMENTARIO]

Bot: "Escribe tu comentario:"

Usuario: "Excelente servicio, muy rápido"

Bot: "¡Gracias por tu retroalimentación!
     Tu opinión nos ayuda a mejorar."

[Estado: FINALIZADO]
```

## Base de Datos

### Tablas Principales
| Tabla | Descripción |
|-------|-------------|
| `Clientes` | Información de clientes (nombre, dirección, ciudad) |
| `Equipos` | Refrigeradores con código SAP, modelo, marca, ubicación |
| `Reportes` | Tickets de fallas (refrigerador o vehículo) |
| `SesionesChat` | Estado de conversación de cada usuario |
| `MensajesChat` | Historial de mensajes de la conversación |
| `Encuestas` | Encuestas de satisfacción vinculadas a reportes |
| `RespuestasEncuesta` | Respuestas individuales a cada pregunta |

### Catálogos
| Catálogo | Valores |
|----------|---------|
| `CatTipoReporte` | REFRIGERADOR, VEHICULO |
| `CatEstadoSesion` | 20 estados normalizados |
| `CatEstadoReporte` | PENDIENTE, EN_PROCESO, RESUELTO, CANCELADO |
| `CatTipoEncuesta` | Tipos de encuesta configurables |
| `CatEstadoEncuesta` | ENVIADA, EN_PROGRESO, COMPLETADA, EXPIRADA |
| `PreguntasEncuesta` | Preguntas dinámicas por tipo de encuesta |

### Stored Procedures
- `sp_CheckSpam` - Detecta spam en BD
- `sp_GetReportesByTelefono` - Reportes de un usuario
- `sp_GetSesionesToClose` - Sesiones para timeout

## Características de Seguridad y Resiliencia

### Deduplicación de Mensajes
- WhatsApp reenvía webhooks si no recibe HTTP 200 en ~20 segundos
- `rateLimiter.isDuplicateMessage(messageId)` previene procesamiento duplicado
- TTL de 30 minutos para messageIds procesados
- Limpieza automática periódica

### Rate Limiting Multinivel
1. **Memoria (rápido)**: Max 20 msgs/min, 100 msgs/hora por usuario
2. **Base de datos (persistente)**: Detección de patrones
3. **Spam detection**: 5+ mensajes en 10 segundos

### Manejo de Errores
- Tipos específicos: DatabaseError, ExternalServiceError, OCRError
- Reintentos automáticos con backoff exponencial (500ms a 5s)
- Lista de errores transitorios de SQL para reconexión
- Siempre responde HTTP 200 a WhatsApp (evita reintentos infinitos)

### Caché Inteligente
- Sesiones: 5 min TTL
- Equipos: 15 min TTL (cambian menos frecuentemente)
- Encuestas: 1 min TTL
- Invalidación automática en actualizaciones

## Características Clave

1. **Detección inteligente**: Reconoce intenciones con regex + IA
2. **Conversación natural**: El usuario escribe como habla normalmente
3. **Múltiples proveedores IA**: Gemini o Azure OpenAI (configurable)
4. **Estados normalizados**: 20 estados con IDs en BD
5. **FlowManager**: Orquestador central que desacopla lógica de flujos
6. **Encuestas automatizadas**: Se envían 24h después de resolver tickets
7. **Deduplicación**: Previene procesamiento de reintentos de WhatsApp
8. **Respuestas rápidas**: < 200ms para responder al webhook
9. **Procesamiento asíncrono**: Imágenes se procesan en background
10. **Tolerante a errores**: Reintentos automáticos, fallbacks, reconexiones
11. **Timeout automático**: Cierra sesiones inactivas con advertencia previa
12. **OCR inteligente**: Extrae códigos SAP de fotos de etiquetas

## Estado Actual del Proyecto

- ✅ Sistema conversacional completo funcional
- ✅ Detección híbrida de intenciones (regex + IA)
- ✅ Soporte para Gemini y Azure OpenAI
- ✅ Flujos completos para refrigeradores, vehículos y consultas
- ✅ Sistema de encuestas de satisfacción automatizado
- ✅ API externa para resolver tickets
- ✅ Procesamiento de imágenes con OCR
- ✅ Caché y optimizaciones de rendimiento
- ✅ Rate limiting y protección contra spam
- ✅ Deduplicación de mensajes
- ✅ Métricas y logging detallado
- ✅ Sistema de timeout con advertencia previa
- ✅ Arquitectura en capas (controllers → flows → services → repositories)

---

**Cliente**: Arca Continental
**Tecnología**: Node.js, Azure Functions, Gemini/Azure OpenAI, WhatsApp Business API
**Versión**: 2.0.0 (POC - Proof of Concept)
**Última actualización**: Enero 2026
