# Guia de Configuracion - AC FixBot

Esta guia detalla todas las variables de entorno y opciones de configuracion del sistema.

---

## Indice

1. [Variables Requeridas](#1-variables-requeridas)
2. [Configuracion de Base de Datos](#2-configuracion-de-base-de-datos)
3. [Configuracion de WhatsApp](#3-configuracion-de-whatsapp)
4. [Configuracion de IA](#4-configuracion-de-ia)
5. [Configuracion de Vision/OCR](#5-configuracion-de-visionocr)
6. [Configuracion de Sesiones](#6-configuracion-de-sesiones)
7. [Configuracion de Encuestas](#7-configuracion-de-encuestas)
8. [Configuracion de Seguridad](#8-configuracion-de-seguridad)
9. [Configuracion de Rate Limiting](#9-configuracion-de-rate-limiting)
10. [Archivo local.settings.json](#10-archivo-localsettingsjson)

---

## 1. Variables Requeridas

Estas variables **deben** estar definidas para que el sistema funcione:

| Variable | Descripcion | Ejemplo |
|----------|-------------|---------|
| `SQL_CONNECTION_STRING` | Connection string de Azure SQL Server | `Server=sql-server.database.windows.net;Database=db-acfixbot;User Id=admin;Password=xxx;Encrypt=true` |
| `WHATSAPP_TOKEN` | Token de acceso permanente de WhatsApp Business API | `EAAGm...` |
| `WHATSAPP_PHONE_ID` | ID del numero de telefono registrado en Meta | `123456789012345` |
| `WHATSAPP_VERIFY_TOKEN` | Token para verificacion del webhook (definido por ti) | `mi_token_secreto_123` |

### Validacion al Inicio

El sistema valida estas variables al iniciar. Si alguna falta, lanzara un error:

```javascript
// core/config/index.js
const REQUIRED_ENV_VARS = [
    'SQL_CONNECTION_STRING',
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_ID',
    'WHATSAPP_VERIFY_TOKEN'
];
```

---

## 2. Configuracion de Base de Datos

### Connection String

```bash
SQL_CONNECTION_STRING="Server=tcp:sql-acfixbot-prod.database.windows.net,1433;Initial Catalog=db-acfixbot;Persist Security Info=False;User ID=sqladmin;Password=TuPassword123!;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"
```

### Parametros de Conexion (en codigo)

```javascript
// core/config/index.js
const database = {
    connectionTimeout: 30000,  // 30 segundos
    requestTimeout: 30000,     // 30 segundos

    // Cache de sesiones
    sessionCache: {
        ttlMs: 5 * 60 * 1000,           // 5 minutos
        cleanupIntervalMs: 2 * 60 * 1000 // Limpieza cada 2 minutos
    },

    // Cache de equipos
    equipoCache: {
        ttlMs: 15 * 60 * 1000,          // 15 minutos
        cleanupIntervalMs: 2 * 60 * 1000
    },

    // Reintentos
    retry: {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2
    }
};
```

### Inicializar Base de Datos

```bash
# Ejecutar script de instalacion completa
sqlcmd -S tu-servidor.database.windows.net -U admin -P password -d db-acfixbot -i sql-scripts/install-full-database.sql

# Agregar tabla Dead Letter (si no existe)
sqlcmd -S tu-servidor.database.windows.net -U admin -P password -d db-acfixbot -i sql-scripts/add-dead-letter-table.sql
```

---

## 3. Configuracion de WhatsApp

### Variables de Entorno

| Variable | Descripcion |
|----------|-------------|
| `WHATSAPP_TOKEN` | Token de acceso (System User Token recomendado) |
| `WHATSAPP_PHONE_ID` | ID del numero de telefono |
| `WHATSAPP_VERIFY_TOKEN` | Token para verificar webhook |
| `WHATSAPP_APP_SECRET` | App Secret para verificar firma X-Hub-Signature-256 |

### Obtener Credenciales

1. Ir a [Meta for Developers](https://developers.facebook.com)
2. Crear o seleccionar App
3. Agregar producto "WhatsApp Business"
4. En WhatsApp > API Setup:
   - Copiar **Phone Number ID**
   - Generar **Permanent Token** (System User recomendado)
5. En Settings > Basic:
   - Copiar **App Secret**

### Configurar Webhook

1. En WhatsApp > Configuration:
   - **Callback URL:** `https://tu-function.azurewebsites.net/api/whatsapp-webhook`
   - **Verify Token:** Tu token personalizado
   - **Webhook Fields:** `messages`, `message_status_updates`

### Verificar Firma (Seguridad)

Si defines `WHATSAPP_APP_SECRET`, el sistema verificara la firma HMAC de cada request:

```javascript
// core/services/infrastructure/securityService.js
const expectedSignature = 'sha256=' +
    crypto.createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');
```

---

## 4. Configuracion de IA

### Variables de Entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `USE_AI` | `false` | Activar/desactivar IA |
| `AI_PROVIDER` | `gemini` | Proveedor: `gemini` o `azure-openai` |

### Opcion A: Google Gemini (Recomendado para POC)

```bash
USE_AI=true
AI_PROVIDER=gemini
GEMINI_API_KEY=tu_api_key_de_gemini
```

**Obtener API Key:**
1. Ir a [Google AI Studio](https://aistudio.google.com)
2. Crear API Key
3. Modelo utilizado: `gemini-2.5-flash`

### Opcion B: Azure OpenAI (Recomendado para Produccion)

```bash
USE_AI=true
AI_PROVIDER=azure-openai
AZURE_OPENAI_ENDPOINT=https://tu-recurso.openai.azure.com/
AZURE_OPENAI_KEY=tu_api_key
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

**Prerequisitos:**
1. Solicitar acceso: https://aka.ms/oai/access
2. Crear recurso Azure OpenAI en Azure Portal
3. Crear deployment con modelo `gpt-4o-mini`

### Comportamiento sin IA

Si `USE_AI=false`, el sistema usa deteccion por regex (menos precisa pero funcional):

```javascript
// Patrones de deteccion por regex
const REFRIGERADOR_PATTERNS = [
    /refri(gerador)?/i,
    /enfriador/i,
    /cooler/i,
    /no\s*(enfria|congela)/i
];
```

---

## 5. Configuracion de Vision/OCR

### Variables de Entorno

| Variable | Descripcion |
|----------|-------------|
| `VISION_ENDPOINT` | Endpoint de Azure Computer Vision |
| `VISION_KEY` | API Key de Azure Computer Vision |

### Ejemplo

```bash
VISION_ENDPOINT=https://cv-acfixbot-prod.cognitiveservices.azure.com/
VISION_KEY=tu_api_key
```

### Crear Recurso

1. En Azure Portal, crear "Computer Vision"
2. SKU: S1 (Standard)
3. Copiar Endpoint y Key

### Uso

El OCR se usa para leer codigos SAP de etiquetas de refrigeradores cuando el usuario envia una foto.

---

## 6. Configuracion de Sesiones

### Variables de Entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `SESSION_TIMEOUT_MINUTES` | `30` | Minutos de inactividad antes de cerrar sesion |
| `SESSION_WARNING_MINUTES` | `25` | Minutos antes de enviar advertencia "¿Sigues ahi?" |
| `TIMER_SCHEDULE` | `0 */5 * * * *` | CRON del timer de limpieza (cada 5 min) |

### Ejemplo

```bash
SESSION_TIMEOUT_MINUTES=30
SESSION_WARNING_MINUTES=25
TIMER_SCHEDULE="0 */5 * * * *"
```

### Formato CRON (Azure Functions)

```
segundo minuto hora dia mes dia-semana
   0      */5    *    *   *      *
```

- `0 */5 * * * *` = Cada 5 minutos
- `0 0 * * * *` = Cada hora
- `0 */15 * * * *` = Cada 15 minutos

### Flujo de Timeout

1. Timer se ejecuta cada 5 minutos
2. Busca sesiones con inactividad > `SESSION_WARNING_MINUTES`
3. Envia mensaje "¿Sigues ahi?"
4. Busca sesiones con inactividad > `SESSION_TIMEOUT_MINUTES`
5. Cierra sesiones expiradas

---

## 7. Configuracion de Encuestas

### Variables de Entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `SURVEY_TIMER_SCHEDULE` | `0 0 9 * * *` | CRON del timer (9 AM diario) |
| `SURVEY_HORAS_ESPERA` | `24` | Horas despues de resolucion para enviar |
| `SURVEY_HORAS_EXPIRACION` | `72` | Horas para expirar encuestas sin respuesta |

### Ejemplo

```bash
SURVEY_TIMER_SCHEDULE="0 0 9 * * *"
SURVEY_HORAS_ESPERA=24
SURVEY_HORAS_EXPIRACION=72
```

### Flujo de Encuestas

1. Timer se ejecuta a las 9 AM diario
2. Busca tickets resueltos hace mas de 24 horas
3. Envia invitacion a encuesta via WhatsApp
4. Usuario responde 6 preguntas (escala 1-5)
5. Encuestas no respondidas expiran a las 72 horas

---

## 8. Configuracion de Seguridad

### Variables de Entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `WHATSAPP_APP_SECRET` | - | App Secret para verificar firma HMAC |
| `ADMIN_API_KEY` | - | API Key para endpoints administrativos |

### Headers de Seguridad

El sistema aplica automaticamente estos headers en todas las respuestas:

```javascript
// core/middleware/securityHeaders.js
{
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cache-Control': 'no-store'
}
```

### Sanitizacion de Inputs

Todos los inputs del usuario se sanitizan automaticamente:

```javascript
// core/middleware/sanitization.js
- Elimina caracteres de control
- Escapa HTML entities
- Limita longitud maxima
- Valida formato E.164 para telefonos
```

---

## 9. Configuracion de Rate Limiting

### Variables de Entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `IP_RATE_LIMIT` | `100` | Max requests por IP en el health check |
| `IP_RATE_WINDOW_MS` | `60000` | Ventana de rate limit (1 minuto) |

### Rate Limiting por Usuario (en codigo)

```javascript
// core/config/index.js
const rateLimiting = {
    messages: {
        maxPerMinute: 20,
        maxPerHour: 100
    },
    images: {
        maxPerMinute: 3,
        maxPerHour: 20
    },
    spam: {
        windowMs: 10000,         // 10 segundos
        maxMessagesInWindow: 10  // >10 = spam
    }
};
```

---

## 10. Archivo local.settings.json

Para desarrollo local, crea un archivo `local.settings.json`:

```json
{
    "IsEncrypted": false,
    "Values": {
        "FUNCTIONS_WORKER_RUNTIME": "node",
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",

        "SQL_CONNECTION_STRING": "Server=localhost;Database=acfixbot;User Id=sa;Password=YourPassword123;TrustServerCertificate=true",

        "WHATSAPP_TOKEN": "EAAGm...",
        "WHATSAPP_PHONE_ID": "123456789012345",
        "WHATSAPP_VERIFY_TOKEN": "mi_token_secreto",
        "WHATSAPP_APP_SECRET": "abc123...",

        "USE_AI": "true",
        "AI_PROVIDER": "gemini",
        "GEMINI_API_KEY": "AIza...",

        "VISION_ENDPOINT": "https://cv-acfixbot.cognitiveservices.azure.com/",
        "VISION_KEY": "abc123...",

        "SESSION_TIMEOUT_MINUTES": "30",
        "SESSION_WARNING_MINUTES": "25",

        "ADMIN_API_KEY": "mi_api_key_admin",

        "NODE_ENV": "development"
    },
    "Host": {
        "CORS": "*"
    }
}
```

**IMPORTANTE:** Este archivo contiene secretos. Nunca lo subas a Git (esta en `.gitignore`).

---

## Verificacion de Configuracion

### Health Check

Usa el endpoint de health para verificar la configuracion:

```bash
curl http://localhost:7071/api/health | jq
```

Respuesta esperada:

```json
{
    "status": "healthy",
    "checks": {
        "database": { "status": "healthy" },
        "configuration": { "status": "healthy" },
        "externalServices": {
            "ai": { "configured": true, "provider": "gemini" },
            "vision": { "configured": true },
            "whatsapp": { "configured": true }
        }
    }
}
```

### Logs de Inicio

Al iniciar, el sistema muestra warnings sobre variables opcionales no configuradas:

```
[CONFIG] WARN: Variables de entorno opcionales no definidas: VISION_ENDPOINT, VISION_KEY
```

---

## Variables por Ambiente

### Desarrollo

```bash
NODE_ENV=development
USE_AI=false  # Opcional, para ahorrar costos
SESSION_TIMEOUT_MINUTES=5  # Timeout rapido para testing
```

### Staging

```bash
NODE_ENV=staging
USE_AI=true
AI_PROVIDER=gemini  # Gemini es mas economico para staging
```

### Produccion

```bash
NODE_ENV=production
USE_AI=true
AI_PROVIDER=azure-openai  # Azure para enterprise
```

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
