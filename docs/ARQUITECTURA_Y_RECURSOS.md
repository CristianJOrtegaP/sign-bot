# AC FixBot - Arquitectura y Recursos Requeridos

## Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        AZURE CLOUD                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐│
│  │                           Resource Group: rg-acfixbot-prod                                   ││
│  │                                                                                              ││
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐   ││
│  │  │                    Azure Function App (Node.js 22) - Consumption Plan                │   ││
│  │  │                                                                                      │   ││
│  │  │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                 │   ││
│  │  │   │  whatsapp-webhook │  │  ticket-resolve  │  │  admin-clear-    │                 │   ││
│  │  │   │       -api        │  │       -api       │  │    cache-api     │                 │   ││
│  │  │   │   (HTTP POST/GET) │  │   (HTTP POST)    │  │   (HTTP GET/POST)│                 │   ││
│  │  │   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘                 │   ││
│  │  │            │                     │                     │                            │   ││
│  │  │   ┌────────┴─────────┐  ┌────────┴─────────┐                                       │   ││
│  │  │   │ session-cleanup  │  │  survey-sender   │                                       │   ││
│  │  │   │     -timer       │  │     -timer       │                                       │   ││
│  │  │   │  (Timer: */5min) │  │  (Timer: 9AM)    │                                       │   ││
│  │  │   └────────┬─────────┘  └────────┬─────────┘                                       │   ││
│  │  │            │                     │                                                  │   ││
│  │  │   ┌────────┴─────────────────────┴─────────────────────────────────────────────┐   │   ││
│  │  │   │                           CAPAS DE APLICACION                               │   │   ││
│  │  │   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │   ││
│  │  │   │  │ Controllers │  │   Flows     │  │  Services   │  │Repositories │       │   │   ││
│  │  │   │  │ messageH.   │  │ refrigerador│  │  ai/        │  │ Sesion      │       │   │   ││
│  │  │   │  │ imageH.     │  │ vehiculo    │  │  core/      │  │ Equipo      │       │   │   ││
│  │  │   │  │ FlowManager │  │ encuesta    │  │  storage/   │  │ Reporte     │       │   │   ││
│  │  │   │  │             │  │ consulta    │  │  processing/│  │ Encuesta    │       │   │   ││
│  │  │   │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │   │   ││
│  │  │   └────────────────────────────────────────────────────────────────────────────┘   │   ││
│  │  │                                                                                      │   ││
│  │  └──────────────────────────────────────────────────────────────────────────────────────┘   ││
│  │                                         │                                                   ││
│  │  ┌──────────────────────────────────────┼──────────────────────────────────────────────┐   ││
│  │  │                              SERVICIOS AZURE                                         │   ││
│  │  │                                      │                                              │   ││
│  │  │  ┌───────────────┐  ┌───────────────┐│  ┌───────────────┐  ┌───────────────┐       │   ││
│  │  │  │  Azure SQL    │  │   IA/NLP      ││  │   Computer    │  │    Blob       │       │   ││
│  │  │  │  Database     │  │   (flexible)  ││  │   Vision      │  │   Storage     │       │   ││
│  │  │  │               │  │               ││  │   (OCR)       │  │  (Imagenes)   │       │   ││
│  │  │  │  - Sesiones   │  │  - Gemini     ││  │               │  │               │       │   ││
│  │  │  │  - Mensajes   │  │  - Azure AOAI ││  │  - Codigos    │  │  - Fotos de   │       │   ││
│  │  │  │  - Tickets    │  │               ││  │    SAP        │  │    equipos    │       │   ││
│  │  │  │  - Encuestas  │  │  - Intencion  ││  │  - Etiquetas  │  │               │       │   ││
│  │  │  │               │  │  - Extraccion ││  │               │  │               │       │   ││
│  │  │  │    $15/mes    │  │    $2/mes     ││  │    $3/mes     │  │    $2/mes     │       │   ││
│  │  │  └───────────────┘  └───────────────┘│  └───────────────┘  └───────────────┘       │   ││
│  │  │                                      │                                              │   ││
│  │  │  ┌───────────────┐  ┌───────────────┐│                                              │   ││
│  │  │  │   Key Vault   │  │  App Insights ││                                              │   ││
│  │  │  │   (Secrets)   │  │    (Logs)     ││                                              │   ││
│  │  │  │    $0.50/mes  │  │    $5/mes     ││                                              │   ││
│  │  │  └───────────────┘  └───────────────┘│                                              │   ││
│  │  │                                      │                                              │   ││
│  │  └──────────────────────────────────────┼──────────────────────────────────────────────┘   ││
│  │                                         │                                                   ││
│  └─────────────────────────────────────────┼───────────────────────────────────────────────────┘│
│                                            │                                                    │
└────────────────────────────────────────────┼────────────────────────────────────────────────────┘
                                             │
                                             │ HTTPS/Webhook
                                             │
┌────────────────────────────────────────────┼────────────────────────────────────────────────────┐
│                                            │                                                    │
│  ┌─────────────────────┐                   │                   ┌─────────────────────┐         │
│  │                     │                   │                   │                     │         │
│  │      Usuario        │◄──── WhatsApp ────┼───── Webhook ────►│    Meta WhatsApp    │         │
│  │     (Tecnico)       │      Mensajes     │                   │     Cloud API       │         │
│  │                     │                   │                   │                     │         │
│  └─────────────────────┘                   │                   └─────────────────────┘         │
│                                            │                                                    │
│                                     INTERNET                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────────────────────┐
                              │     COSTO TOTAL: ~$30-35 USD/mes    │
                              │     (100 reportes/dia)              │
                              └─────────────────────────────────────┘
```

---

## Flujo de Datos Principal (Webhook)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    FLUJO DE MENSAJES                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

    Usuario                  Meta                    Azure Function              Base de Datos
       │                      │                           │                           │
       │  1. Envia mensaje    │                           │                           │
       │─────────────────────►│                           │                           │
       │                      │  2. Webhook POST          │                           │
       │                      │──────────────────────────►│                           │
       │                      │                           │  3. Deduplicacion         │
       │                      │                           │  4. Rate Limiting         │
       │                      │                           │  5. Guarda mensaje        │
       │                      │                           │──────────────────────────►│
       │                      │                           │                           │
       │                      │                           │  6. Obtiene sesion        │
       │                      │                           │◄──────────────────────────│
       │                      │                           │                           │
       │                      │                    ┌──────┴──────┐                    │
       │                      │                    │  7. Detecta │                    │
       │                      │                    │  intencion  │                    │
       │                      │                    │ (Regex/IA)  │                    │
       │                      │                    └──────┬──────┘                    │
       │                      │                           │                           │
       │                      │                    ┌──────┴──────┐                    │
       │                      │                    │ 8. FlowMgr  │                    │
       │                      │                    │ enruta al   │                    │
       │                      │                    │ flujo       │                    │
       │                      │                    └──────┬──────┘                    │
       │                      │                           │                           │
       │                      │                           │  9. Actualiza sesion      │
       │                      │                           │──────────────────────────►│
       │                      │                           │                           │
       │                      │  10. Envia respuesta      │                           │
       │                      │◄──────────────────────────│                           │
       │  11. Recibe mensaje  │                           │                           │
       │◄─────────────────────│                           │                           │
       │                      │                           │                           │
```

---

## Flujo de Encuestas (Timer Automatico)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                FLUJO DE ENCUESTAS AUTOMATICAS                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

   Timer (9AM)              survey-sender-timer          Base de Datos              WhatsApp
       │                           │                           │                       │
       │  1. Trigger CRON          │                           │                       │
       │──────────────────────────►│                           │                       │
       │                           │  2. Busca reportes        │                       │
       │                           │  resueltos >24h           │                       │
       │                           │──────────────────────────►│                       │
       │                           │                           │                       │
       │                           │  3. Lista de reportes     │                       │
       │                           │◄──────────────────────────│                       │
       │                           │                           │                       │
       │                           │  Para cada reporte:       │                       │
       │                           │  ┌────────────────────────┼───────────────────┐   │
       │                           │  │ 4. Crea encuesta       │                   │   │
       │                           │  │──────────────────────►│                   │   │
       │                           │  │                        │                   │   │
       │                           │  │ 5. Envia invitacion    │                   │   │
       │                           │  │────────────────────────┼──────────────────►│   │
       │                           │  │                        │                   │   │
       │                           │  │ 6. Actualiza estado    │                   │   │
       │                           │  │ sesion a ENCUESTA_INV. │                   │   │
       │                           │  │──────────────────────►│                   │   │
       │                           │  └────────────────────────┼───────────────────┘   │
       │                           │                           │                       │
       │                           │  7. Expira encuestas >72h │                       │
       │                           │──────────────────────────►│                       │
       │                           │                           │                       │
```

---

## Azure Functions (5 Total)

### 1. whatsapp-webhook-api (HTTP Trigger)
| Propiedad | Valor |
|-----------|-------|
| Ruta | `GET/POST /api/whatsapp-webhook-api` |
| Autenticacion | Anonymous + Verify Token |
| Timeout | 230 segundos |
| Responsabilidad | Webhook principal de WhatsApp |

### 2. ticket-resolve-api (HTTP Trigger)
| Propiedad | Valor |
|-----------|-------|
| Ruta | `POST /api/resolveTicket` |
| Autenticacion | Function Level (API Key) |
| Payload | `{ "ticketId": "TKT..." }` |
| Responsabilidad | API externa para marcar tickets como RESUELTO |

### 3. admin-clear-cache-api (HTTP Trigger)
| Propiedad | Valor |
|-----------|-------|
| Ruta | `GET/POST /api/adminClearCache` |
| Autenticacion | Function Level (API Key) |
| Parametros | `type=equipos|sesiones|all|stats|trigger_timeout` |
| Responsabilidad | Administracion y limpieza de cache |

### 4. session-cleanup-timer (Timer Trigger)
| Propiedad | Valor |
|-----------|-------|
| Schedule | `*/5 * * * *` (cada 5 minutos) |
| Configurable | `TIMER_SCHEDULE` env var |
| Responsabilidad | Timeout de sesiones inactivas, advertencias |

### 5. survey-sender-timer (Timer Trigger)
| Propiedad | Valor |
|-----------|-------|
| Schedule | `0 9 * * *` (9:00 AM diario) |
| Configurable | `SURVEY_TIMER_SCHEDULE` env var |
| Responsabilidad | Envio automatico de encuestas de satisfaccion |

---

## Recursos de Azure Requeridos

### 1. Resource Group
| Propiedad | Valor |
|-----------|-------|
| Nombre | `rg-acfixbot-{env}` |
| Ubicacion | `westus2` (recomendado) |

### 2. Azure SQL Server + Database
| Propiedad | Valor |
|-----------|-------|
| Servidor | `sql-acfixbot-{env}-{suffix}` |
| Base de Datos | `db-acfixbot` |
| SKU | `S0` |
| DTUs | 10 |
| Costo Aprox. | ~$15/mes |

**Tablas Principales:**
| Tabla | Descripcion |
|-------|-------------|
| `SesionesChat` | Estado de conversacion por usuario |
| `MensajesChat` | Historial de mensajes |
| `Reportes` | Tickets de fallas |
| `Equipos` | Catalogo de refrigeradores (SAP) |
| `Clientes` | Informacion de clientes |
| `Encuestas` | Encuestas de satisfaccion |
| `RespuestasEncuesta` | Respuestas individuales |
| `PreguntasEncuesta` | Preguntas configurables |

**Catalogos:**
| Catalogo | Valores |
|----------|---------|
| `CatEstadoSesion` | 20 estados (INICIO, REFRI_*, VEHICULO_*, ENCUESTA_*, etc.) |
| `CatTipoReporte` | REFRIGERADOR, VEHICULO |
| `CatEstadoReporte` | PENDIENTE, EN_PROCESO, RESUELTO, CANCELADO |
| `CatTipoEncuesta` | Tipos configurables de encuesta |
| `CatEstadoEncuesta` | ENVIADA, EN_PROGRESO, COMPLETADA, EXPIRADA |

### 3. Storage Account
| Propiedad | Valor |
|-----------|-------|
| Nombre | `stacfixbot{env}{suffix}` |
| SKU | `Standard_LRS` |
| Tier | `Hot` |
| Costo Aprox. | ~$2/mes |

**Contenedores:**
- `imagenes-tickets` - Fotos de equipos (comprimidas con JIMP)

### 4. Azure Function App
| Propiedad | Valor |
|-----------|-------|
| Nombre | `func-acfixbot-{env}-{suffix}` |
| Runtime | `Node.js 22` |
| Plan | `Consumption (Y1)` |
| Functions | 5 (webhook, resolve, admin, session-timer, survey-timer) |
| Costo Aprox. | ~$3-5/mes |

### 5. Computer Vision (Azure AI)
| Propiedad | Valor |
|-----------|-------|
| Nombre | `cv-acfixbot-{env}` |
| SKU | `S1` |
| Uso | OCR de codigos SAP en etiquetas |
| Costo Aprox. | ~$3/mes (3,000 imagenes) |

### 6. IA/NLP (Configurable - Gemini o Azure OpenAI)

#### Opcion A: Google Gemini (POC)
| Propiedad | Valor |
|-----------|-------|
| Modelo | `gemini-2.5-flash` |
| Uso | Deteccion de intenciones, extraccion de datos |
| Costo Aprox. | ~$2/mes |

#### Opcion B: Azure OpenAI (Produccion)
| Propiedad | Valor |
|-----------|-------|
| Nombre | `aoai-acfixbot-{env}` |
| Ubicacion | `eastus` (mejor disponibilidad) |
| Modelo | `gpt-4o-mini` |
| Deployment | `gpt-4o-mini` |
| Costo Aprox. | ~$2/mes (8,400 llamadas) |

**Nota:** Azure OpenAI requiere solicitar acceso en https://aka.ms/oai/access

### 7. Key Vault
| Propiedad | Valor |
|-----------|-------|
| Nombre | `kv-acfixbot-{env}-{suffix}` |
| SKU | `Standard` |
| Uso | Almacen de secrets (API keys, tokens) |

### 8. Application Insights
| Propiedad | Valor |
|-----------|-------|
| Nombre | `appi-acfixbot-{env}-{suffix}` |
| Uso | Logs, metricas, trazas, alertas |

---

## Recursos de Meta (WhatsApp Business) Requeridos

### Checklist para el Cliente

#### A. Meta Business Suite
- [ ] **Business Manager ID** - Identificador de la cuenta de negocio
- [ ] **Cuenta de WhatsApp Business** verificada
- [ ] **Numero de telefono** dedicado para el bot (no puede usarse en WhatsApp personal)

#### B. Meta for Developers (developers.facebook.com)
- [ ] **App ID** - Identificador de la aplicacion
- [ ] **App Secret** - Secreto de la aplicacion
- [ ] **WhatsApp Business Account ID (WABA ID)**
- [ ] **Phone Number ID** - ID del numero de telefono registrado
- [ ] **Access Token** (permanente o de sistema)

#### C. Configuracion del Webhook
| Parametro | Valor |
|-----------|-------|
| Callback URL | `https://func-acfixbot-{env}.azurewebsites.net/api/whatsapp-webhook-api` |
| Verify Token | (definido por el desarrollador) |
| Campos suscritos | `messages`, `message_echoes`, `message_status_updates` |

### Permisos de la App (API Permissions)
- [ ] `whatsapp_business_messaging` - Enviar/recibir mensajes
- [ ] `whatsapp_business_management` - Gestionar templates

### Templates de Mensaje (si se usan notificaciones proactivas)
- [ ] Template de bienvenida (opcional)
- [ ] Template de confirmacion de ticket
- [ ] Template de actualizacion de estado
- [ ] Template de invitacion a encuesta

---

## Estimacion de Costos Mensuales

### Volumen de Produccion Estimado
| Metrica | Cantidad |
|---------|----------|
| Reportes por dia | 100 |
| Reportes por mes | 3,000 |
| Mensajes por reporte (promedio) | ~7 |
| Total mensajes/mes | ~21,000 |
| Llamadas a IA (~40%) | ~8,400 |
| Imagenes procesadas/mes | ~3,000 |
| Encuestas enviadas/mes | ~2,500 |

### Ambiente Produccion (100 reportes/dia)
| Recurso | SKU | Costo/mes |
|---------|-----|-----------|
| Azure SQL Database | S0 (10 DTUs) | $15 |
| Storage Account | Standard_LRS | $2 |
| Function App | Consumption (Y1) | $3-5 |
| Computer Vision | S1 (3,000 imgs) | $3 |
| IA (Gemini o Azure OpenAI) | Pay-as-you-go | $2 |
| Key Vault | Standard (~10 secrets) | $0.50 |
| Application Insights | Pay-as-you-go | $5 |
| **TOTAL PRODUCCION** | | **~$30-35 USD/mes** |

### Detalle IA (gpt-4o-mini / Gemini)
| Concepto | Tokens/mes | Precio | Costo |
|----------|------------|--------|-------|
| Input (prompts del sistema + usuario) | ~4.2M | $0.15/1M | $0.63 |
| Output (respuestas JSON) | ~2.1M | $0.60/1M | $1.26 |
| **Total IA** | | | **~$2** |

### Escalabilidad de Costos
| Escenario | Reportes/dia | Costo Mensual |
|-----------|--------------|---------------|
| Actual | 50 | ~$25 |
| Proyectado | 100 | ~$35 |
| Crecimiento 2x | 200 | ~$45 |
| Crecimiento 5x | 500 | ~$80 |

---

## Informacion que Solicitar al Cliente

### 1. Meta / WhatsApp Business
```
□ Business Manager ID
□ WhatsApp Business Account ID (WABA ID)
□ Phone Number ID
□ Access Token (System User Token recomendado)
□ Numero de telefono dedicado (+52...)
□ Verify Token (para webhook, puede ser cualquier string)
```

### 2. Azure (si usan suscripcion del cliente)
```
□ Subscription ID
□ Tenant ID
□ Permisos de Contributor en Resource Group
□ Region preferida
□ Politicas de naming convention
□ Requisitos de compliance (datos en Mexico, etc.)
```

### 3. Integracion SAP (Fase 2)
```
□ URL del RFC/API de SAP para crear avisos PM
□ Credenciales de servicio
□ Campos requeridos para el aviso:
  - Centro de trabajo
  - Tipo de aviso
  - Prioridad
  - etc.
□ Ambiente de pruebas disponible
```

### 4. Datos de Negocio
```
□ Lista de tiendas/ubicaciones (para validacion)
□ Lista de tecnicos (para asignacion)
□ Catalogo de tipos de falla
□ SLAs esperados de respuesta
□ Horarios de atencion
□ Preguntas de encuesta personalizadas
```

---

## Arquitectura de Seguridad

```
┌──────────────────────────────────────────────────────────────────┐
│                        CAPAS DE SEGURIDAD                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. TRANSPORTE                                                    │
│     └── HTTPS obligatorio en todos los endpoints                  │
│     └── TLS 1.2+ para conexiones a BD                            │
│                                                                   │
│  2. AUTENTICACION                                                 │
│     └── WhatsApp: Verify Token + Firma HMAC                      │
│     └── ticket-resolve-api: Function Key (API Key)               │
│     └── admin-clear-cache-api: Function Key (API Key)            │
│     └── Azure: Managed Identity para servicios internos          │
│     └── Key Vault: Control de acceso RBAC                        │
│                                                                   │
│  3. DATOS SENSIBLES                                               │
│     └── API Keys en Key Vault (no en codigo)                     │
│     └── Connection strings cifradas                               │
│     └── Sin PII en logs (telefonos sanitizados)                  │
│                                                                   │
│  4. RATE LIMITING (Multinivel)                                    │
│     └── Memoria: Max 20 msgs/minuto, 100/hora por usuario        │
│     └── Base de datos: Deteccion de patrones de spam             │
│     └── Spam detection: 5+ msgs en 10 segundos                   │
│     └── Deduplicacion: TTL 30 min para messageIds                │
│                                                                   │
│  5. VALIDACION                                                    │
│     └── Sanitizacion de inputs (XSS prevention)                  │
│     └── Validacion E.164 para telefonos                          │
│     └── Validacion de formato SAP                                │
│     └── Escape de caracteres especiales en SQL                   │
│                                                                   │
│  6. RESILIENCIA                                                   │
│     └── Reintentos con backoff exponencial (500ms a 5s)          │
│     └── Lista de errores transitorios SQL                        │
│     └── Siempre responde HTTP 200 a WhatsApp                     │
│     └── Cache multinivel con invalidacion automatica             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Arquitectura de Capas (Codigo)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ARQUITECTURA DE CAPAS                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    1. AZURE FUNCTIONS (Entry Points)            │ │
│  │   whatsapp-webhook-api  ticket-resolve-api  admin-clear-cache   │ │
│  │   session-cleanup-timer survey-sender-timer                     │ │
│  └────────────────────────────────┬───────────────────────────────┘ │
│                                   │                                  │
│  ┌────────────────────────────────▼───────────────────────────────┐ │
│  │                    2. CONTROLLERS (Presentacion)                │ │
│  │   messageHandler.js  imageHandler.js  FlowManager.js            │ │
│  └────────────────────────────────┬───────────────────────────────┘ │
│                                   │                                  │
│  ┌────────────────────────────────▼───────────────────────────────┐ │
│  │                    3. FLOWS (Logica de Negocio)                 │ │
│  │   refrigeradorFlow  vehiculoFlow  encuestaFlow  consultaFlow    │ │
│  └────────────────────────────────┬───────────────────────────────┘ │
│                                   │                                  │
│  ┌────────────────────────────────▼───────────────────────────────┐ │
│  │                    4. SERVICES (Transversales)                  │ │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │ │
│  │   │  ai/    │  │  core/  │  │external/│  │   processing/   │  │ │
│  │   │aiService│  │rateLim. │  │whatsapp │  │backgroundProc.  │  │ │
│  │   │intent   │  │errorH.  │  │Service  │  │sessionTimeout   │  │ │
│  │   │vision   │  │metrics  │  │         │  │imageProcessor   │  │ │
│  │   └─────────┘  └─────────┘  └─────────┘  └─────────────────┘  │ │
│  │   ┌─────────────────────────────────────────────────────────┐  │ │
│  │   │                     storage/                             │  │ │
│  │   │   databaseService  connectionPool  blobService           │  │ │
│  │   └─────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────┬───────────────────────────────┘ │
│                                   │                                  │
│  ┌────────────────────────────────▼───────────────────────────────┐ │
│  │                    5. REPOSITORIES (Acceso a Datos)             │ │
│  │   BaseRepository  SesionRepo  EquipoRepo  ReporteRepo           │ │
│  │   EncuestaRepo (con cache TTL y reintentos automaticos)         │ │
│  └────────────────────────────────┬───────────────────────────────┘ │
│                                   │                                  │
│  ┌────────────────────────────────▼───────────────────────────────┐ │
│  │                    6. INFRAESTRUCTURA                           │ │
│  │   Azure SQL  Azure Blob  WhatsApp API  Gemini/Azure OpenAI      │ │
│  │   Computer Vision  Key Vault  Application Insights              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Variables de Entorno

### Requeridas
| Variable | Descripcion |
|----------|-------------|
| `SQL_CONNECTION_STRING` | Connection string de Azure SQL |
| `WHATSAPP_TOKEN` | Token de acceso de WhatsApp Business API |
| `WHATSAPP_PHONE_ID` | ID del numero de telefono de WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificacion del webhook |

### Opcionales - IA
| Variable | Default | Descripcion |
|----------|---------|-------------|
| `USE_AI` | false | Activar/desactivar IA |
| `AI_PROVIDER` | gemini | 'gemini' o 'azure-openai' |
| `GEMINI_API_KEY` | - | API Key de Google Gemini |
| `AZURE_OPENAI_ENDPOINT` | - | Endpoint de Azure OpenAI |
| `AZURE_OPENAI_KEY` | - | API Key de Azure OpenAI |
| `AZURE_OPENAI_DEPLOYMENT` | - | Deployment name |

### Opcionales - Servicios
| Variable | Default | Descripcion |
|----------|---------|-------------|
| `VISION_ENDPOINT` | - | Endpoint Azure Computer Vision |
| `VISION_KEY` | - | API Key Azure Computer Vision |
| `BLOB_CONNECTION_STRING` | - | Connection string Blob Storage |

### Opcionales - Timers y Sesiones
| Variable | Default | Descripcion |
|----------|---------|-------------|
| `SESSION_TIMEOUT_MINUTES` | 30 | Inactividad antes de timeout |
| `SESSION_WARNING_MINUTES` | 25 | Antes de advertencia |
| `TIMER_SCHEDULE` | */5 * * * * | CRON timer sesiones |
| `SURVEY_TIMER_SCHEDULE` | 0 9 * * * | CRON timer encuestas |
| `SURVEY_MINUTOS_ESPERA` | 1440 | Minutos despues de resolver |
| `SURVEY_HORAS_EXPIRACION` | 72 | Horas para expirar encuesta |

---

## Proximos Pasos para Produccion

1. **Configurar suscripcion Azure del cliente**
2. **Obtener credenciales de WhatsApp Business API**
3. **Elegir proveedor de IA** (Gemini para POC, Azure OpenAI para produccion)
4. **Solicitar acceso a Azure OpenAI** (si aplica)
5. **Configurar preguntas de encuesta personalizadas**
6. **Definir integracion con SAP** (Fase 2)
7. **Configurar ambiente de staging**
8. **Pruebas de carga y seguridad**
9. **Documentacion de operacion**
10. **Capacitacion al equipo de soporte**

---

---

## Documentos Relacionados

### Documentacion Principal
- [README.md](../README.md) - Guia de inicio rapido del proyecto

### Guias de Implementacion
- [GUIA_CONFIGURACION.md](./GUIA_CONFIGURACION.md) - Configuracion de variables de entorno
- [GUIA_PERSONALIZACION.md](./GUIA_PERSONALIZACION.md) - Personalizacion de mensajes y flujos
- [GUIA_DEPLOYMENT.md](./GUIA_DEPLOYMENT.md) - Despliegue en Azure Functions
- [GUIA_OPERACION.md](./GUIA_OPERACION.md) - Monitoreo y troubleshooting

### Documentacion Tecnica
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - Documentacion de endpoints REST
- [ADR-001-DECISIONES-ARQUITECTURA.md](./ADR-001-DECISIONES-ARQUITECTURA.md) - Decisiones arquitectonicas (Redis, Circuit Breaker, Dead Letter, etc.)

### Contexto del Proyecto
- [PROMPT_INICIAL_PROYECTO.md](./PROMPT_INICIAL_PROYECTO.md) - Contexto original del proyecto

---

**Version**: 2.2.0
**Ultima actualizacion**: Enero 2026
