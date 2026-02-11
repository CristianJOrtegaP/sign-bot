# API e Integraciones — Sign Bot

> Audiencia: Developers, QA Engineers
> Última actualización: Febrero 2026

---

## Tabla de Contenidos

1. [Meta Graph API (WhatsApp)](#meta-graph-api-whatsapp)
2. [Azure OpenAI / Gemini](#azure-openai--gemini)
3. [Azure Computer Vision (OCR)](#azure-computer-vision-ocr)
4. [Transcripción de Audio](#transcripción-de-audio)
5. [Azure Maps](#azure-maps)
6. [API Interna (Admin)](#api-interna-admin)

---

## Meta Graph API (WhatsApp)

**Versión:** v22.0
**Base URL:** `https://graph.facebook.com/v22.0`
**Archivo:** `core/services/external/whatsappService.js`

### Verificación del Webhook (GET)

Meta envía un `GET` para verificar la propiedad del webhook al configurarlo:

```
GET /api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
```

| Parámetro          | Descripción                                |
| ------------------ | ------------------------------------------ |
| `hub.mode`         | Siempre `subscribe`                        |
| `hub.verify_token` | Debe coincidir con `WHATSAPP_VERIFY_TOKEN` |
| `hub.challenge`    | Número que se devuelve como respuesta      |

**Respuesta exitosa:** `200` con el valor de `hub.challenge` como body (número, no string).

### Recepción de Mensajes (POST)

```
POST /api/whatsapp-webhook
Content-Type: application/json
X-Hub-Signature-256: sha256=<hex_signature>
```

**Validación de Firma (HMAC-SHA256):**

```javascript
// core/services/infrastructure/securityService.js
function verifyWebhookSignature(rawBody, signatureHeader) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  const providedSignature = signatureHeader.replace('sha256=', '');

  // Comparación timing-safe para evitar timing attacks
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature));
}
```

> En desarrollo local, `SKIP_SIGNATURE_VALIDATION=true` permite bypass. Esta variable es **ignorada** cuando se ejecuta en Azure (`WEBSITE_SITE_NAME` presente).

**Payload de ejemplo (mensaje de texto):**

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "5215512345678",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": { "name": "Juan Pérez" },
                "wa_id": "5215512345678"
              }
            ],
            "messages": [
              {
                "from": "5215512345678",
                "id": "wamid.HBg...",
                "timestamp": "1706140800",
                "text": { "body": "El refrigerador no enfría" },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### Tipos de Mensaje Soportados

| Tipo          | Handler              | Campo del payload                        |
| ------------- | -------------------- | ---------------------------------------- |
| `text`        | `textHandler.js`     | `message.text.body`                      |
| `image`       | `imageHandler.js`    | `message.image.id`                       |
| `audio`       | `audioHandler.js`    | `message.audio.id`                       |
| `interactive` | `buttonHandler.js`   | `message.interactive.button_reply.id`    |
| `location`    | `locationHandler.js` | `message.location.{latitude, longitude}` |

### Envío de Mensajes

**Texto simple:**

```
POST https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "5215512345678",
  "type": "text",
  "text": { "body": "Su ticket TKT-12345678 ha sido creado." }
}
```

**Botones interactivos:**

```json
{
  "messaging_product": "whatsapp",
  "to": "5215512345678",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": { "type": "text", "text": "Confirmar equipo" },
    "body": { "text": "¿Este es su refrigerador? Modelo: XYZ, SAP: 1234567" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "confirmar_equipo_si", "title": "Sí, es correcto" } },
        { "type": "reply", "reply": { "id": "confirmar_equipo_no", "title": "No, es otro" } }
      ]
    }
  }
}
```

> **Límite de título de botón:** 20 caracteres máximo.

**Lista interactiva:**

```json
{
  "messaging_product": "whatsapp",
  "to": "5215512345678",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "body": { "text": "Seleccione una opción:" },
    "action": {
      "button": "Ver opciones",
      "sections": [
        {
          "title": "Opciones",
          "rows": [
            {
              "id": "opcion_1",
              "title": "Refrigerador",
              "description": "Reportar falla de refrigerador"
            },
            { "id": "opcion_2", "title": "Vehículo", "description": "Reportar falla de vehículo" }
          ]
        }
      ]
    }
  }
}
```

**Descarga de media:**

```javascript
// 1. Obtener URL del media
GET https://graph.facebook.com/v22.0/{MEDIA_ID}
Authorization: Bearer {WHATSAPP_TOKEN}
// Response: { "url": "https://lookaside.fbsbx.com/..." }

// 2. Descargar el archivo
GET {media_url}
Authorization: Bearer {WHATSAPP_TOKEN}
// Response: Buffer (image/jpeg, audio/ogg, etc.)
```

### Circuit Breaker y Retry

```
Configuración:
├── Timeout: 10s (mensajes), 30s (descarga de media)
├── Max retries: 2
├── Backoff: exponencial (1s, 2s, 4s) + jitter 25%
├── Max delay: 30s
└── Errores retryable: timeout, 429, 5xx
```

### Typing Indicator

```javascript
// Envía indicador "escribiendo..." antes de responder
sendTypingIndicator(to, messageId);
// POST /{PHONE_NUMBER_ID}/messages
// { "messaging_product": "whatsapp", "status": "read", "message_id": messageId }
```

---

## Azure OpenAI / Gemini

**Archivo principal:** `core/services/ai/aiService.js`
**Providers:** `core/services/ai/providers/`

### Selección de Provider

```javascript
// core/config/index.js
AI_PROVIDER = 'azure-openai'; // Producción
AI_PROVIDER = 'gemini'; // desarrollo
```

| Provider     | Modelo             | SDK                   | Timeout | Max Tokens | Temperatura |
| ------------ | ------------------ | --------------------- | ------- | ---------- | ----------- |
| Azure OpenAI | `gpt-4o-mini`      | openai v6.18.0        | 8s      | 200        | 0.3         |
| Gemini       | `gemini-2.5-flash` | @google/generative-ai | 8s      | 200        | 0.3         |

### Detección de Intención (3 Tiers)

**Archivo:** `core/services/ai/intentService.js`

```
Tier 1: Cache estático (< 0.1ms)
├── "hola" → SALUDO
├── "cancelar" → CANCELAR
├── "adiós" → DESPEDIDA
└── Map<string, string> hardcoded

Tier 2: Regex patterns (< 1ms)
├── /refri|enfr|congel/i → TIPO_REFRIGERADOR
├── /vehic|cami[oó]n|carro/i → TIPO_VEHICULO
├── /report|falla|averi/i → REPORTAR_FALLA
├── /cancel|salir|dejar/i → CANCELAR
├── /hola|buenos|buen/i → SALUDO
└── /adi[oó]s|hasta luego|bye/i → DESPEDIDA

Tier 3: AI (100-500ms)
├── Normalizar texto (lowercase, trim, remove accents)
├── Buscar en cache local (Map, 500 entries, 5 min TTL)
├── Buscar en Redis (si habilitado)
├── Llamar a provider (Azure OpenAI o Gemini)
├── Guardar resultado en ambos caches
└── Retornar {intencion, confianza, datos_extraidos}
```

### Intenciones Soportadas

| Intención           | Confianza mínima | Acción                        |
| ------------------- | ---------------- | ----------------------------- |
| `SALUDO`            | 0.9 (regex)      | Mostrar menú principal        |
| `CANCELAR`          | 0.9 (regex)      | Cancelar flujo activo         |
| `DESPEDIDA`         | 0.9 (regex)      | Despedir y resetear           |
| `REPORTAR_FALLA`    | 0.7 (AI)         | Iniciar flujo de reporte      |
| `TIPO_REFRIGERADOR` | 0.7 (AI)         | Seleccionar tipo refrigerador |
| `TIPO_VEHICULO`     | 0.7 (AI)         | Seleccionar tipo vehículo     |
| `MODIFICAR_DATOS`   | 0.7 (AI)         | Modificar campo del reporte   |
| `DESCONOCIDO`       | —                | Responder con menú de ayuda   |

### System Prompts

**Archivo:** `core/services/ai/providers/prompts.js`

#### DETECT_INTENT

```
Eres un clasificador de intenciones para un chatbot de WhatsApp de reportes
de fallas. Clasifica el siguiente mensaje del usuario en una de estas
categorías: SALUDO, CANCELAR, DESPEDIDA, REPORTAR_FALLA, TIPO_REFRIGERADOR,
TIPO_VEHICULO, MODIFICAR_DATOS, DESCONOCIDO.

Responde SOLO con JSON:
{"intencion": "...", "confianza": 0.0-1.0, "datos_extraidos": {...}}
```

#### EXTRACT_STRUCTURED_DATA

```
Extrae datos estructurados del siguiente mensaje. El usuario está reportando
una falla. Extrae cualquier dato relevante como: descripción del problema,
código SAP, número de empleado, modelo, marca.

Responde SOLO con JSON:
{"descripcion": "...", "codigoSAP": "...", "numeroEmpleado": "...", ...}
```

#### INTERPRET_TERM

```
El usuario escribió un término ambiguo. Determina si se refiere a un
refrigerador, vehículo u otro equipo. Considera sinónimos y regionalismos
mexicanos.
```

### Token Usage Logging

```javascript
// azureOpenAIProvider.js
// Cada llamada registra el consumo de tokens para monitoreo de costos
logger.info('AI token usage', {
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
});
```

---

## Azure Computer Vision (OCR)

**Archivo:** `core/services/ai/visionService.js`
**API:** Azure Computer Vision — Read API

### Flujo de Extracción OCR

```
1. Recibir imageBuffer
      │
2. POST {VISION_ENDPOINT}/vision/v3.2/read/analyze
   Headers: Ocp-Apim-Subscription-Key: {VISION_KEY}
   Content-Type: application/octet-stream
   Body: imageBuffer
      │
3. Polling: GET {operation-location}
   ├── Status: notStarted → running → succeeded
   ├── Max intentos: 15
   ├── Intervalo: 1 segundo entre intentos
   └── Timeout total: ~15 segundos
      │
4. Extraer líneas de texto:
   result.analyzeResult.readResults[].lines[].text
      │
5. Buscar código SAP: /\b(\d{7})\b/
   └── Primer match de 7 dígitos consecutivos
```

### Configuración

```javascript
vision: {
  endpoint: process.env.VISION_ENDPOINT,
  apiKey: process.env.VISION_KEY,
  ocr: {
    language: 'es',
    maxAttempts: 15,
    pollIntervalMs: 1000,
  },
  sapCodePattern: /\b(\d{7})\b/,  // 7 dígitos = código SAP
}
```

### Tipos de Error

| Error          | Causa                       | Acción                                  |
| -------------- | --------------------------- | --------------------------------------- |
| `NetworkError` | Endpoint no disponible      | Circuit breaker se activa               |
| `TimeoutError` | Polling excedió 15 intentos | Informar al usuario, pedir texto manual |
| `OCRError`     | Imagen ilegible             | Pedir foto más clara                    |

### Rate Limit de Imágenes

```javascript
// imageHandler.js
// Protección contra abuso de envío de imágenes
maxImagesPerMinute: 3;
maxImagesPerHour: 20;
```

### Procesamiento en Background

Las imágenes se procesan asincrónicamente para no bloquear el webhook:

```
1. Respuesta inmediata: "Procesando tu imagen..."
2. Background:
   a. Descargar media de WhatsApp (30s timeout)
   b. Comprimir con jimp (max 10MB)
   c. Subir a Azure Blob Storage
   d. Ejecutar OCR
   e. Buscar código SAP
   f. Si encontrado → buscar equipo en BD
   g. Actualizar sesión con FlexibleFlowContext
   h. Enviar resultado al usuario
```

---

## Transcripción de Audio

**Archivo:** `core/services/ai/audioTranscriptionService.js`

### Cadena de Fallback

```
┌────────────────────────┐
│ 1. Azure Whisper       │  Primary
│    (OpenAI deployment) │  Config: AZURE_AUDIO_DEPLOYMENT
│    SDK: openai v6      │
└──────────┬─────────────┘
           │ Falla
┌──────────▼─────────────┐
│ 2. Azure Speech        │  Fallback (5 hrs/mes gratis)
│    Services            │  Config: AZURE_SPEECH_KEY + REGION
│    REST API            │
└──────────┬─────────────┘
           │ Falla
┌──────────▼─────────────┐
│ 3. Google Speech       │  Solo desarrollo (NODE_ENV !== 'production')
│    (v1 REST)           │  Config: GOOGLE_SPEECH_API_KEY
└────────────────────────┘
```

### Límites de Audio

| Parámetro                | Valor                |
| ------------------------ | -------------------- |
| Tamaño máximo            | 25 MB                |
| Tamaño mínimo            | 1 KB                 |
| Duración máxima          | 300 segundos (5 min) |
| Timeout de procesamiento | 60 segundos          |
| Idioma                   | `es` (español)       |

### Formatos Soportados

```
audio/ogg, audio/mpeg, audio/mp3, audio/mp4,
audio/wav, audio/webm, audio/x-m4a, audio/opus
```

> WhatsApp envía audio en formato OGG/Opus. Si el provider requiere WAV, se convierte automáticamente.

### Flujo de Procesamiento

```
1. Descargar audio de WhatsApp (mediaId → Buffer)
2. Validar tamaño y formato
3. Intentar transcripción (cadena de fallback)
4. Si éxito → procesar como mensaje de texto (textHandler)
5. Si falla → informar al usuario
```

---

## Azure Maps

**Archivo:** `bot/services/` + stored procedures
**API Key:** `AZURE_MAPS_KEY`

### Geocodificación Inversa

Cuando el usuario envía una ubicación GPS, se usa Azure Maps para obtener la dirección:

```
GET https://atlas.microsoft.com/search/address/reverse/json
  ?api-version=1.0
  &query={latitude},{longitude}
  &subscription-key={AZURE_MAPS_KEY}
```

### Centro de Servicio Más Cercano

**Stored Procedure:** `sp_GetCentroServicioMasCercano`

Usa la fórmula de Haversine para calcular la distancia entre las coordenadas del usuario y todos los centros de servicio activos:

```sql
-- Fórmula de Haversine (distancia esférica)
SELECT TOP 1
    Id, Nombre, Direccion, Telefono,
    (6371 * ACOS(
        COS(RADIANS(@lat)) * COS(RADIANS(Latitud)) *
        COS(RADIANS(Longitud) - RADIANS(@lon)) +
        SIN(RADIANS(@lat)) * SIN(RADIANS(Latitud))
    )) AS DistanciaKm
FROM CentrosServicio
WHERE Activo = 1
ORDER BY DistanciaKm ASC
```

**Datos del resultado:**

| Campo                   | Descripción                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `CentroServicioId`      | FK al centro asignado                                           |
| `DistanciaCentroKm`     | Distancia en km                                                 |
| `TiempoEstimadoMinutos` | ETA = (distancia / velocidad promedio) + `ROUTE_BUFFER_MINUTES` |
| `DireccionUbicacion`    | Dirección geocodificada del usuario                             |

---

## API Interna (Admin)

**Función:** `api-admin`
**Ruta:** `POST /api/admin/{action}/{subaction}`
**Autenticación:** Azure Function Key (header `x-functions-key`)
**Rate limit:** `ADMIN_RATE_LIMIT_MAX` req/min (default: 60)

### Endpoints Disponibles

| Action    | Subaction  | Método | Descripción                                  |
| --------- | ---------- | ------ | -------------------------------------------- |
| `cache`   | `clear`    | POST   | Limpiar todo el cache (Redis + local)        |
| `cache`   | `stats`    | GET    | Estadísticas de cache (hits, misses, tamaño) |
| `metrics` | `sessions` | GET    | Métricas de sesiones activas                 |
| `metrics` | `reports`  | GET    | Estadísticas de reportes                     |
| `metrics` | `surveys`  | GET    | Estadísticas de encuestas                    |
| `ticket`  | `resolve`  | POST   | Marcar ticket como resuelto                  |

### Health Check

**Función:** `api-health`
**Ruta:** `GET /api/health`
**Sin autenticación** (público)

**Respuesta:**

```json
{
  "status": "healthy",
  "timestamp": "2026-02-06T10:00:00Z",
  "checks": {
    "database": { "status": "healthy", "latency": "12ms" },
    "redis": { "status": "healthy", "latency": "3ms", "fallback": false },
    "whatsapp": { "status": "healthy" }
  },
  "version": "2.1.0"
}
```

### API de Conversaciones

**Función:** `api-conversations`

Permite consultar el historial de mensajes de un teléfono:

```
GET /api/conversations?telefono=5215512345678&limit=50
```

**Respuesta:** Array de `MensajesChat` ordenados por `FechaCreacion DESC`.

---

## Resumen de Configuración por Servicio

| Servicio        | Variables Requeridas                                                   | Fallback si no configurado                     |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| WhatsApp API    | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`           | Sistema no funciona                            |
| Azure OpenAI    | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Usa Gemini si `AI_PROVIDER=gemini`             |
| Gemini          | `GEMINI_API_KEY`                                                       | Usa Azure OpenAI si `AI_PROVIDER=azure-openai` |
| Computer Vision | `VISION_ENDPOINT`, `VISION_KEY`                                        | OCR deshabilitado, pide datos manuales         |
| Audio (Whisper) | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_AUDIO_DEPLOYMENT`  | Intenta Azure Speech                           |
| Audio (Speech)  | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`                              | Intenta Google Speech (dev)                    |
| Redis           | `REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PASSWORD`                        | Cache local en memoria (Map)                   |
| Azure Maps      | `AZURE_MAPS_KEY`                                                       | Centro de servicio no calculado                |
| Blob Storage    | `BLOB_CONNECTION_STRING`                                               | Imágenes no se almacenan                       |
