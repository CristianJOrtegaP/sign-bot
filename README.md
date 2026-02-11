# Sign Bot

WhatsApp chatbot for digital document signing via DocuSign.

Sign Bot sends outbound document notifications to clients via WhatsApp, provides embedded signing links through DocuSign recipient views, and handles rejection flows with reason capture. Designed for Arca Continental's document signing workflows with automatic reminders and housekeeping.

> **Version:** 1.0.0 | **Runtime:** Node.js 22 LTS | **Azure Functions v4**

---

## Architecture

| Layer             | Technology                       | Purpose                                            |
| ----------------- | -------------------------------- | -------------------------------------------------- |
| **Runtime**       | Node.js 22 LTS                   | Azure Functions v4                                 |
| **Messaging**     | Meta Graph API v22.0             | WhatsApp Business Platform                         |
| **Signing**       | DocuSign eSign API (JWT Grant)   | Document envelope creation and embedded signing    |
| **Database**      | Azure SQL Server                 | Persistence with optimistic locking + stored procs |
| **Cache**         | Azure Cache for Redis (TLS:6380) | Sessions, distributed locking                      |
| **Storage**       | Azure Blob Storage               | Document storage                                   |
| **Frontend**      | Azure Static Web Apps            | Real-time dashboard with document analytics        |
| **Monitoring**    | Application Insights             | W3C distributed tracing + custom metrics           |
| **Notifications** | Microsoft Teams Webhooks         | SAP/internal alerts for stale documents            |

---

## Features

- Outbound document notifications via WhatsApp templates
- Embedded signing links (DocuSign recipient view)
- Rejection handling with reason capture
- Automatic reminders (48h client, 7d SAP/Teams)
- 30-day housekeeping for stale documents
- Real-time dashboard with document analytics
- Circuit breaker pattern for external services
- Dead letter queue for failed message reprocessing
- Optimistic locking for session consistency

---

## High-Level Architecture

```
                                        +-------------------------------+
                                        |      Azure Functions v4       |
+---------------+   HTTPS   +--------->|                               |--------->+--------------+
|               |            |          |  HTTP Triggers:               |          |  Azure SQL   |
|   WhatsApp    |------------+          |   - api-whatsapp-webhook      |          |  (db-signbot)|
|   (Meta)      |<-----------+          |   - api-sap-document          |          +--------------+
|               |            |          |   - api-docusign-webhook      |
+---------------+            |          |   - api-health                |          +--------------+
                             |          |   - api-admin/{action}        |          | Azure Redis  |
                             |          |   - api-conversations         |          | Cache (TLS)  |
                             |          |                               |          +--------------+
+---------------+            |          |  Timer Triggers:              |
|   DocuSign    |<-----------+          |   - timer-session-cleanup     |          +--------------+
|   eSign API   |                       |   - timer-firma-reminder      |          | Blob Storage |
+---------------+                       |   - timer-dlq-processor       |          +--------------+
                                        |                               |
+---------------+                       |  Queue Trigger:               |          +--------------+
|   Teams       |<----------------------|   - queue-message-processor   |          | Static Web   |
|   Webhooks    |                       +-------------------------------+          | App (SWA)    |
+---------------+                                                                 +--------------+
```

---

## Project Structure

```
sign-bot/
|
+-- api-whatsapp-webhook/              # WhatsApp webhook (HTTP POST/GET)
+-- api-sap-document/                  # SAP document ingestion endpoint
+-- api-docusign-webhook/              # DocuSign Connect webhook
+-- api-health/                        # Health check with connectivity diagnostics
+-- api-admin/                         # Admin API: cache, metrics, documents
+-- api-conversations/                 # Conversation history by phone number
|
+-- timer-session-cleanup/             # Close inactive sessions (every 5 min)
+-- timer-firma-reminder/              # Send reminders + housekeeping (9:00 AM)
+-- timer-dlq-processor/               # Reprocess dead letter queue
+-- queue-message-processor/           # Service Bus queue consumer
|
+-- bot/
|   +-- controllers/
|   |   +-- messageHandler/            # Main router by message type
|   +-- flows/
|   |   +-- firmaFlow.js              # Document signing flow
|   |   +-- consultaDocumentosFlow.js  # Document status inquiry
|   |   +-- index.js                   # Flow registry
|   +-- repositories/                  # Data access layer (SQL + cache)
|   |   +-- BaseRepository.js         # Connection pool + cache TTL + retries
|   |   +-- SesionRepository.js       # Sessions with optimistic locking (Version)
|   |   +-- DocumentoFirmaRepository.js # Document signing records
|   |   +-- EventoDocuSignRepository.js # DocuSign event tracking
|   +-- schemas/                       # Zod validation schemas
|   +-- constants/                     # Session states, messages, templates
|
+-- core/
|   +-- config/index.js               # Centralized config + env var validation
|   +-- flowEngine/                    # Conversation flow engine
|   +-- services/
|   |   +-- cache/redisService.js     # Redis with automatic fallback to local Map
|   |   +-- external/whatsappService.js # Meta Graph API v22.0 + circuit breaker
|   |   +-- infrastructure/           # Logger, metrics, security, circuit breaker
|   |   +-- processing/               # Background processor, session timeout
|   |   +-- storage/                   # Connection pool (SQL), blob, database
|   |   +-- messaging/                # Service Bus integration
|   +-- middleware/                    # Rate limiting, security headers
|   +-- errors/                        # Custom error classes
|   +-- utils/                         # Retry, helpers, sanitizer, semaphore
|
+-- frontend/                          # Static Web App dashboard
|   +-- css/                           # Dashboard styles
|   +-- js/                            # Dashboard JS modules
|   +-- index.html                     # Main dashboard page
|
+-- sql-scripts/
|   +-- install-full-database.sql     # Complete idempotent DB schema
|
+-- infra/                             # Bicep IaC templates
|   +-- main.bicep                    # Main orchestrator
|   +-- modules/                       # Individual resource modules
|   +-- parameters/                    # Environment-specific params
|
+-- tests/                             # Jest: unit, integration, e2e
+-- docs/                              # Technical documentation
+-- scripts/                           # Azure deployment scripts
```

---

## Setup

### 1. Install dependencies

```bash
git clone <repo-url> && cd sign-bot
npm install
```

### 2. Install database

```bash
# The script is idempotent: creates tables, indexes, SPs, and catalog data
sqlcmd -S <server> -d db-signbot -U <user> -P <password> \
  -i sql-scripts/install-full-database.sql
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the values, or create `local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",

    "SQL_CONNECTION_STRING": "Server=tcp:srv.database.windows.net,1433;Database=db-signbot;...",

    "WHATSAPP_TOKEN": "<Meta Graph API access token>",
    "WHATSAPP_PHONE_ID": "<Phone Number ID>",
    "WHATSAPP_VERIFY_TOKEN": "<webhook verification token>",
    "WHATSAPP_APP_SECRET": "<App Secret for HMAC-SHA256>",

    "DOCUSIGN_INTEGRATION_KEY": "<DocuSign integration key>",
    "DOCUSIGN_USER_ID": "<DocuSign user ID for JWT>",
    "DOCUSIGN_ACCOUNT_ID": "<DocuSign account ID>",
    "DOCUSIGN_BASE_URL": "https://demo.docusign.net/restapi",
    "DOCUSIGN_RSA_PRIVATE_KEY": "<RSA private key for JWT Grant>",
    "DOCUSIGN_WEBHOOK_SECRET": "<DocuSign Connect HMAC secret>",
    "DOCUSIGN_ENVELOPE_EXPIRATION_DAYS": "30"
  }
}
```

### 4. Run locally

```bash
# Start Azure Functions
func start

# Or with npm
npm start
```

### 5. Configure Webhooks

**WhatsApp (Meta):**

1. Meta Developers -> WhatsApp -> Configuration
2. Callback URL: `https://<function-app>.azurewebsites.net/api/whatsapp-webhook`
3. Verify Token: value of `WHATSAPP_VERIFY_TOKEN`
4. Subscriptions: `messages`

**DocuSign Connect:**

1. DocuSign Admin -> Connect
2. URL: `https://<function-app>.azurewebsites.net/api/docusign-webhook`
3. Enable HMAC signature verification

---

## Environment Variables

### Required

| Variable                   | Description                                   |
| -------------------------- | --------------------------------------------- |
| `SQL_CONNECTION_STRING`    | Connection string to Azure SQL / SQL Server   |
| `WHATSAPP_TOKEN`           | Meta Graph API access token                   |
| `WHATSAPP_PHONE_ID`        | WhatsApp Business Phone Number ID             |
| `WHATSAPP_VERIFY_TOKEN`    | Token for webhook verification handshake      |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign app integration key                  |
| `DOCUSIGN_USER_ID`         | DocuSign user ID for JWT Grant authentication |
| `DOCUSIGN_ACCOUNT_ID`      | DocuSign account ID                           |
| `DOCUSIGN_BASE_URL`        | DocuSign REST API base URL                    |
| `DOCUSIGN_RSA_PRIVATE_KEY` | RSA private key for JWT Grant auth            |

### DocuSign & Firma

| Variable                            | Description                                   | Default       |
| ----------------------------------- | --------------------------------------------- | ------------- |
| `DOCUSIGN_WEBHOOK_SECRET`           | HMAC secret for DocuSign Connect verification | --            |
| `DOCUSIGN_ENVELOPE_EXPIRATION_DAYS` | Days before an envelope expires               | `30`          |
| `FIRMA_REMINDER_HOURS_CLIENTE`      | Hours before sending client reminder          | `48`          |
| `FIRMA_MAX_RECORDATORIOS_CLIENTE`   | Max reminder count per client                 | `3`           |
| `FIRMA_REMINDER_DAYS_SAP`           | Days before escalating to SAP/Teams           | `7`           |
| `FIRMA_HOUSEKEEPING_DAYS`           | Days before cleaning up stale documents       | `30`          |
| `FIRMA_TIMER_SCHEDULE`              | CRON schedule for reminders timer             | `0 0 9 * * *` |

### Cache and Storage

| Variable                 | Description                             | Default    |
| ------------------------ | --------------------------------------- | ---------- |
| `REDIS_ENABLED`          | Enable distributed cache                | `false`    |
| `REDIS_HOST`             | Azure Cache for Redis host              | --         |
| `REDIS_PORT`             | Port (TLS required on Azure)            | `6380`     |
| `REDIS_PASSWORD`         | Access Key                              | --         |
| `REDIS_KEY_PREFIX`       | Prefix to avoid multi-tenant collisions | `signbot:` |
| `BLOB_CONNECTION_STRING` | Azure Blob Storage connection string    | --         |

### Security and Notifications

| Variable                    | Description                                  | Default |
| --------------------------- | -------------------------------------------- | ------- |
| `WHATSAPP_APP_SECRET`       | Meta App Secret for HMAC-SHA256 verification | --      |
| `SKIP_SIGNATURE_VALIDATION` | Bypass signature check (**local dev only**)  | `false` |
| `ADMIN_RATE_LIMIT_MAX`      | Requests per minute to admin API             | `60`    |
| `TEAMS_WEBHOOK_URL`         | Microsoft Teams incoming webhook URL         | --      |

---

## Database

Run the full idempotent database installation script:

```bash
sqlcmd -S <server> -d db-signbot -U <user> -P <password> \
  -i sql-scripts/install-full-database.sql
```

---

## Deployment

### Azure Functions (Backend)

```bash
# Build and deploy
func azure functionapp publish func-signbot-<env>
```

### Static Web App (Frontend Dashboard)

The frontend is deployed separately via Azure Static Web Apps. See `.github/workflows/` for CI/CD pipelines.

### Infrastructure (Bicep)

```bash
# Deploy infrastructure for an environment
az deployment sub create \
  --location eastus \
  --template-file infra/main.bicep \
  --parameters infra/parameters/<env>.bicepparam
```

---

## Tests

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage

# Specific project
npm run test:unit
npm run test:integration
npm run test:e2e
```

---

## License

Private project -- Arca Continental. All rights reserved.
