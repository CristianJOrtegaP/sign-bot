# AC FixBot - Documentacion de API

Esta documentacion cubre todos los endpoints HTTP disponibles en AC FixBot.

---

## Indice

1. [Descripcion General](#descripcion-general)
2. [Autenticacion](#autenticacion)
3. [Endpoints](#endpoints)
   - [Health Check](#1-health-check)
   - [WhatsApp Webhook](#2-whatsapp-webhook)
   - [Resolver Ticket](#3-resolver-ticket)
   - [Administracion de Cache](#4-administracion-de-cache)
4. [Timers (Funciones Programadas)](#timers-funciones-programadas)
5. [Codigos de Error](#codigos-de-error)
6. [Ejemplos con cURL](#ejemplos-con-curl)
7. [Postman Collection](#postman-collection)

---

## Descripcion General

AC FixBot expone 4 endpoints HTTP y 2 timers programados:

| Tipo | Nombre | Descripcion |
|------|--------|-------------|
| HTTP | `/api/health` | Health check del sistema |
| HTTP | `/api/whatsapp-webhook` | Webhook para mensajes de WhatsApp |
| HTTP | `/api/ticket-resolve` | Marcar tickets como resueltos |
| HTTP | `/api/admin-cache` | Administracion de cache |
| Timer | `session-cleanup` | Limpieza de sesiones inactivas |
| Timer | `survey-sender` | Envio de encuestas de satisfaccion |

**Base URL:**
- Produccion: `https://func-acfixbot-prod.azurewebsites.net`
- Local: `http://localhost:7071`

---

## Autenticacion

### 1. Webhook WhatsApp

**Verificacion (GET):**
- Query param `hub.verify_token` debe coincidir con variable `WHATSAPP_VERIFY_TOKEN`

**Mensajes (POST):**
- Header `X-Hub-Signature-256` con firma HMAC-SHA256
- Calculada como: `sha256=HMAC(body, WHATSAPP_APP_SECRET)`

### 2. Azure Functions Key

Para endpoints con `authLevel: function` (`ticket-resolve`):

```http
x-functions-key: <azure-function-key>
```

Obtener la key en: Azure Portal → Function App → App Keys

### 3. API Key Administrativa

Para endpoints administrativos (`admin-cache`):

```http
X-API-Key: <admin-api-key>
```

O como query param:
```
?apiKey=<admin-api-key>
```

Configurada via variable `ADMIN_API_KEY`

---

## Endpoints

### 1. Health Check

Verifica el estado de salud del sistema completo.

| Propiedad | Valor |
|-----------|-------|
| URL | `GET /api/health` |
| Auth | Ninguna (rate limited por IP) |
| Rate Limit | 100 requests/minuto por IP |

#### Request

```http
GET /api/health HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
```

#### Response (200 OK)

```json
{
    "status": "healthy",
    "timestamp": "2026-01-27T10:30:00.000Z",
    "version": "2.0.0",
    "environment": "production",
    "responseTimeMs": 45,
    "checks": {
        "database": {
            "status": "healthy",
            "message": "Connection successful",
            "responseTimeMs": 23
        },
        "configuration": {
            "status": "healthy",
            "message": "All required environment variables are set",
            "servicesConfigured": true
        },
        "memory": {
            "status": "healthy",
            "heapUsedMB": 45,
            "heapTotalMB": 128,
            "heapPercentage": 35
        },
        "uptime": {
            "status": "healthy",
            "uptimeSeconds": 3600
        },
        "circuitBreakers": {
            "status": "healthy",
            "services": {
                "ai": {
                    "status": "closed",
                    "provider": "gemini",
                    "enabled": true
                },
                "whatsapp": {
                    "status": "closed"
                }
            }
        },
        "deadLetter": {
            "status": "healthy",
            "total": 5,
            "pending": 3,
            "failed": 2,
            "message": "OK"
        },
        "externalServices": {
            "status": "healthy",
            "services": {
                "ai": {
                    "configured": true,
                    "provider": "gemini",
                    "enabled": true
                },
                "vision": {
                    "configured": true
                },
                "whatsapp": {
                    "configured": true
                }
            }
        }
    }
}
```

#### Response (503 Service Unavailable)

```json
{
    "status": "unhealthy",
    "checks": {
        "database": {
            "status": "unhealthy",
            "message": "Connection timeout"
        }
    }
}
```

#### Response (429 Too Many Requests)

```json
{
    "status": "rate_limited",
    "message": "Too many requests",
    "retryAfterMs": 60000
}
```

---

### 2. WhatsApp Webhook

Endpoint para recibir mensajes de WhatsApp via Meta Cloud API.

#### 2.1 Verificacion del Webhook (GET)

Meta envia esta solicitud para verificar el webhook.

| Propiedad | Valor |
|-----------|-------|
| URL | `GET /api/whatsapp-webhook` |
| Auth | Verify Token |

##### Request

```http
GET /api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=mi_token&hub.challenge=123456789 HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
```

##### Response (200 OK)

```
123456789
```

##### Response (403 Forbidden)

```
Forbidden
```

#### 2.2 Recibir Mensajes (POST)

Recibe mensajes entrantes de WhatsApp.

| Propiedad | Valor |
|-----------|-------|
| URL | `POST /api/whatsapp-webhook` |
| Auth | X-Hub-Signature-256 |

##### Headers

```http
Content-Type: application/json
X-Hub-Signature-256: sha256=abc123...
```

##### Request Body (Mensaje de texto)

```json
{
    "object": "whatsapp_business_account",
    "entry": [{
        "id": "123456789",
        "changes": [{
            "value": {
                "messaging_product": "whatsapp",
                "metadata": {
                    "display_phone_number": "15551234567",
                    "phone_number_id": "123456789"
                },
                "messages": [{
                    "id": "wamid.ABC123...",
                    "from": "5218112345678",
                    "timestamp": "1706300000",
                    "type": "text",
                    "text": {
                        "body": "El refrigerador no enfria"
                    }
                }]
            },
            "field": "messages"
        }]
    }]
}
```

##### Request Body (Imagen)

```json
{
    "object": "whatsapp_business_account",
    "entry": [{
        "changes": [{
            "value": {
                "messages": [{
                    "id": "wamid.ABC123...",
                    "from": "5218112345678",
                    "type": "image",
                    "image": {
                        "id": "media_id_123",
                        "mime_type": "image/jpeg"
                    }
                }]
            }
        }]
    }]
}
```

##### Request Body (Boton interactivo)

```json
{
    "object": "whatsapp_business_account",
    "entry": [{
        "changes": [{
            "value": {
                "messages": [{
                    "id": "wamid.ABC123...",
                    "from": "5218112345678",
                    "type": "interactive",
                    "interactive": {
                        "type": "button_reply",
                        "button_reply": {
                            "id": "btn_tipo_refrigerador",
                            "title": "Refrigerador"
                        }
                    }
                }]
            }
        }]
    }]
}
```

##### Request Body (Ubicacion)

```json
{
    "object": "whatsapp_business_account",
    "entry": [{
        "changes": [{
            "value": {
                "messages": [{
                    "id": "wamid.ABC123...",
                    "from": "5218112345678",
                    "type": "location",
                    "location": {
                        "latitude": 25.6866,
                        "longitude": -100.3161,
                        "name": "Monterrey, NL",
                        "address": "Av. Constitucion 123"
                    }
                }]
            }
        }]
    }]
}
```

##### Response

Siempre responde `200 OK` para evitar reintentos de Meta:

```http
HTTP/1.1 200 OK
x-correlation-id: corr-abc123-def456-ghi789

OK
```

##### Tipos de Mensaje Soportados

| Tipo | Descripcion |
|------|-------------|
| `text` | Mensaje de texto |
| `image` | Imagen (procesada con OCR) |
| `interactive` | Respuesta a botones |
| `location` | Ubicacion GPS |

---

### 3. Resolver Ticket

Marca un ticket como RESUELTO. Usado por sistemas externos.

| Propiedad | Valor |
|-----------|-------|
| URL | `POST /api/ticket-resolve` |
| Auth | Azure Functions Key |

#### Request

```http
POST /api/ticket-resolve HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
Content-Type: application/json
x-functions-key: tu-function-key

{
    "ticketId": "TKT1706300000000"
}
```

#### Formato de ticketId

- Prefijo: `TKT`
- Sufijo: 13 digitos (timestamp Unix en milisegundos)
- Ejemplo: `TKT1706300000000`

#### Response (200 OK)

```json
{
    "success": true,
    "message": "Ticket TKT1706300000000 marcado como RESUELTO",
    "ticketId": "TKT1706300000000",
    "previousState": "PENDIENTE",
    "newState": "RESUELTO"
}
```

#### Response (400 Bad Request)

```json
{
    "success": false,
    "error": "ticketId es requerido"
}
```

```json
{
    "success": false,
    "error": "Formato de ticketId invalido. Formato esperado: TKT-XXXXXXXX (8 caracteres hex)"
}
```

```json
{
    "success": false,
    "error": "El ticket ya esta RESUELTO o CANCELADO"
}
```

#### Response (404 Not Found)

```json
{
    "success": false,
    "error": "Ticket no encontrado"
}
```

---

### 4. Administracion de Cache

Gestion del cache en memoria del sistema.

| Propiedad | Valor |
|-----------|-------|
| URL | `GET/POST /api/admin-cache` |
| Auth | API Key (X-API-Key header o apiKey query) |

#### Operaciones Disponibles

| type | Parametros Adicionales | Descripcion |
|------|------------------------|-------------|
| `stats` | - | Ver estadisticas del cache |
| `equipos` | - | Limpiar todo el cache de equipos |
| `equipos` | `codigo` | Limpiar equipo especifico |
| `sesiones` | - | Limpiar todas las sesiones |
| `sesiones` | `telefono` | Limpiar sesion especifica |
| `all` | - | Limpiar todo el cache |
| `trigger_timeout` | - | Ejecutar limpieza de sesiones expiradas |

#### Request: Ver Estadisticas

```http
GET /api/admin-cache?type=stats HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
X-API-Key: tu-api-key
```

#### Response: Estadisticas

```json
{
    "success": true,
    "stats": {
        "equipos": {
            "entries": 150,
            "hits": 1234,
            "misses": 56
        },
        "sesiones": {
            "entries": 25,
            "active": 10
        },
        "messageDedup": {
            "entries": 500
        }
    }
}
```

#### Request: Limpiar Sesion Especifica

```http
GET /api/admin-cache?type=sesiones&telefono=5218112345678 HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
X-API-Key: tu-api-key
```

#### Response: Sesion Limpiada

```json
{
    "success": true,
    "message": "Sesion de 5218112345678 limpiada",
    "cleared": 1
}
```

#### Request: Limpiar Todo

```http
GET /api/admin-cache?type=all HTTP/1.1
Host: func-acfixbot-prod.azurewebsites.net
X-API-Key: tu-api-key
```

#### Response: Todo Limpiado

```json
{
    "success": true,
    "message": "Todo el cache ha sido limpiado",
    "cleared": {
        "equipos": 150,
        "sesiones": 25,
        "messageDedup": 500
    }
}
```

---

## Timers (Funciones Programadas)

### Session Cleanup Timer

| Propiedad | Valor |
|-----------|-------|
| Nombre | `timer-session-cleanup` |
| Schedule | Cada 5 minutos (configurable) |
| Variable | `TIMER_SCHEDULE` |
| CRON | `0 */5 * * * *` |

**Funciones:**
1. Busca sesiones inactivas > `SESSION_WARNING_MINUTES`
2. Envia mensaje "¿Sigues ahi?"
3. Busca sesiones inactivas > `SESSION_TIMEOUT_MINUTES`
4. Cierra sesiones expiradas

### Survey Sender Timer

| Propiedad | Valor |
|-----------|-------|
| Nombre | `timer-survey-sender` |
| Schedule | 9:00 AM diario (configurable) |
| Variable | `SURVEY_TIMER_SCHEDULE` |
| CRON | `0 0 9 * * *` |

**Funciones:**
1. Busca tickets resueltos hace > `SURVEY_HORAS_ESPERA`
2. Crea registro de encuesta en BD
3. Envia invitacion via WhatsApp
4. Expira encuestas sin respuesta > `SURVEY_HORAS_EXPIRACION`

---

## Codigos de Error

| Status | Significado | Cuando Ocurre |
|--------|-------------|---------------|
| 200 | OK | Solicitud exitosa |
| 400 | Bad Request | Parametros invalidos o faltantes |
| 401 | Unauthorized | Firma HMAC invalida (webhook) |
| 403 | Forbidden | Token de verificacion incorrecto |
| 404 | Not Found | Ticket no encontrado |
| 429 | Too Many Requests | Rate limit excedido |
| 500 | Internal Server Error | Error interno del servidor |
| 503 | Service Unavailable | Sistema no saludable |

---

## Ejemplos con cURL

### Health Check

```bash
curl -s https://func-acfixbot-prod.azurewebsites.net/api/health | jq
```

### Resolver Ticket

```bash
curl -X POST \
    -H "x-functions-key: tu-function-key" \
    -H "Content-Type: application/json" \
    -d '{"ticketId": "TKT1706300000000"}' \
    https://func-acfixbot-prod.azurewebsites.net/api/ticket-resolve
```

### Ver Estadisticas de Cache

```bash
curl -H "X-API-Key: tu-api-key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=stats"
```

### Limpiar Sesion

```bash
curl -H "X-API-Key: tu-api-key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=sesiones&telefono=5218112345678"
```

### Verificar Webhook (Simulacion)

```bash
curl "https://func-acfixbot-prod.azurewebsites.net/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=mi_token&hub.challenge=123456"
```

---

## Postman Collection

### Archivos Disponibles

| Archivo | Descripcion |
|---------|-------------|
| `AC-FIXBOT-API.postman_collection.json` | Coleccion completa con todos los endpoints |
| `AC-FIXBOT-API.postman_environment.json` | Variables de entorno para desarrollo local |
| `AC-FIXBOT-API-Production.postman_environment.json` | Variables de entorno para produccion |

### Como Importar

1. Abrir Postman
2. Click en **Import** (Ctrl+O / Cmd+O)
3. Arrastrar los archivos JSON o seleccionarlos
4. Seleccionar el environment apropiado (Local o Production)
5. Configurar las variables de entorno:
   - `baseUrl`: URL base del servidor
   - `functionKey`: Azure Functions key
   - `adminApiKey`: API key administrativa
   - `verifyToken`: Token de verificacion de webhook

### Variables de Entorno

| Variable | Local | Production |
|----------|-------|------------|
| `baseUrl` | `http://localhost:7071` | `https://func-acfixbot-prod.azurewebsites.net` |
| `functionKey` | (no requerida) | `tu-function-key` |
| `adminApiKey` | `dev-key` | `tu-api-key` |
| `verifyToken` | `test-token` | `mi_token_secreto` |

---

## Correlation ID

Todas las respuestas del webhook incluyen un header de correlation para trazabilidad:

```http
x-correlation-id: corr-abc123-def456-ghi789
```

Usar este ID para:
- Correlacionar logs en Application Insights
- Rastrear el flujo de un mensaje especifico
- Debugging y troubleshooting

---

## Variables de Entorno del Servidor

Ver [GUIA_CONFIGURACION.md](./GUIA_CONFIGURACION.md) para documentacion completa de todas las variables de entorno.

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
