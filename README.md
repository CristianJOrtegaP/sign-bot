# AC FixBot

**Chatbot de WhatsApp para reportes de fallas de refrigeradores y vehiculos**

[![Node.js](https://img.shields.io/badge/Node.js-22-green.svg)](https://nodejs.org/)
[![Azure Functions](https://img.shields.io/badge/Azure%20Functions-v4-blue.svg)](https://azure.microsoft.com/services/functions/)
[![Tests](https://img.shields.io/badge/Tests-458%20passing-success.svg)](./tests/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

---

## Descripcion

AC FixBot es un chatbot de WhatsApp desarrollado para Arca Continental que permite a tecnicos de campo reportar fallas en refrigeradores y vehiculos de manera rapida y sencilla. El sistema utiliza IA para detectar intenciones y extraer datos automaticamente, reduciendo la friccion en el proceso de reporte.

### Caracteristicas Principales

- **Reportes via WhatsApp** - Interfaz familiar para los usuarios
- **Deteccion de intenciones con IA** - Gemini o Azure OpenAI (configurable)
- **OCR para codigos SAP** - Lectura automatica de etiquetas de equipos
- **Encuestas de satisfaccion** - Recoleccion automatica de feedback
- **Arquitectura serverless** - Azure Functions con costo optimizado (~$30-35/mes)
- **Resiliencia integrada** - Circuit Breaker, Dead Letter Queue, reintentos automaticos

---

## Inicio Rapido

### Prerrequisitos

- Node.js 22+
- Azure Functions Core Tools v4
- Cuenta de Azure con suscripcion activa
- WhatsApp Business API (Meta)

### Instalacion Local

```bash
# 1. Clonar repositorio
git clone https://github.com/arca-continental/acfixbot.git
cd acfixbot

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp local.settings.json.example local.settings.json
# Editar local.settings.json con tus credenciales

# 4. Ejecutar tests
npm test

# 5. Iniciar servidor local
npm start
```

### Variables de Entorno Minimas

```bash
# Base de datos (requerido)
SQL_CONNECTION_STRING="Server=...;Database=db-acfixbot;..."

# WhatsApp (requerido)
WHATSAPP_TOKEN="tu_token_de_whatsapp"
WHATSAPP_PHONE_ID="tu_phone_number_id"
WHATSAPP_VERIFY_TOKEN="tu_token_de_verificacion"

# IA (opcional pero recomendado)
USE_AI=true
AI_PROVIDER=gemini
GEMINI_API_KEY="tu_api_key_de_gemini"
```

Ver [GUIA_CONFIGURACION.md](./docs/GUIA_CONFIGURACION.md) para configuracion completa.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    Azure Functions (Node.js 22)                  │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  webhook    │ │ ticket-      │ │ admin-      │ │  health   │ │
│  │  (POST/GET) │ │ resolve      │ │ cache       │ │  (GET)    │ │
│  └──────┬──────┘ └──────────────┘ └─────────────┘ └───────────┘ │
│         │                                                        │
│  ┌──────┴───────────────────────────────────────────────────┐   │
│  │  Controllers → Flows → Services → Repositories            │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐        ┌─────▼────┐        ┌────▼────┐
   │  Azure  │        │  IA/NLP  │        │ WhatsApp│
   │   SQL   │        │(Gemini/  │        │   API   │
   │         │        │ Azure)   │        │         │
   └─────────┘        └──────────┘        └─────────┘
```

Ver [ARQUITECTURA_Y_RECURSOS.md](./docs/ARQUITECTURA_Y_RECURSOS.md) para diagrama completo.

---

## Estructura del Proyecto

```
acfixbot/
├── api-whatsapp-webhook/     # Webhook principal de WhatsApp
├── api-ticket-resolve/       # API para resolver tickets
├── api-admin-cache/          # API de administracion
├── api-health/               # Health check
├── timer-session-cleanup/    # Timer para timeout de sesiones
├── timer-survey-sender/      # Timer para envio de encuestas
├── bot/
│   ├── controllers/          # Manejadores de mensajes
│   │   ├── messageHandler.js
│   │   ├── imageHandler.js
│   │   └── flows/            # Flujos de conversacion
│   │       ├── FlowManager.js
│   │       ├── refrigeradorFlow.js
│   │       ├── vehiculoFlow.js
│   │       ├── encuestaFlow.js
│   │       └── consultaEstadoFlow.js
│   ├── repositories/         # Acceso a datos
│   │   ├── BaseRepository.js # Cache TTL + reintentos
│   │   ├── SesionRepository.js
│   │   ├── EquipoRepository.js
│   │   ├── ReporteRepository.js
│   │   └── EncuestaRepository.js
│   ├── constants/            # Mensajes y estados
│   └── schemas/              # Validacion con Zod
├── core/
│   ├── config/               # Configuracion centralizada
│   ├── middleware/           # Rate limiting, security
│   ├── services/
│   │   ├── ai/               # Gemini, Azure OpenAI
│   │   ├── storage/          # SQL, Blob
│   │   ├── external/         # WhatsApp API
│   │   ├── infrastructure/   # Circuit Breaker, Dead Letter
│   │   └── processing/       # Background tasks
│   ├── errors/               # Clases de error custom
│   └── utils/                # Helpers
├── docs/                     # Documentacion
├── sql-scripts/              # Scripts de base de datos
└── tests/                    # Tests (458 tests)
    ├── unit/
    ├── integration/
    ├── flows/
    └── fixtures/
```

---

## Flujos de Conversacion

### Reporte de Refrigerador

```
Usuario: "El refrigerador no enfria"
Bot: Detecta intencion → Pide SAP
Usuario: Envia foto de etiqueta
Bot: OCR extrae SAP → Valida en BD → Confirma equipo
Usuario: Confirma
Bot: Crea ticket → Envia confirmacion
```

### Reporte de Vehiculo

```
Usuario: "Mi camion no arranca"
Bot: Detecta intencion → Pide numero de empleado
Usuario: "12345"
Bot: Registra empleado → Pide SAP del vehiculo
Usuario: "1234567"
Bot: Registra → Pide ubicacion GPS
Usuario: Envia ubicacion
Bot: Crea ticket → Envia confirmacion
```

### Encuesta de Satisfaccion

```
(Automatico 24h despues de resolucion)
Bot: Envia invitacion a encuesta
Usuario: Acepta
Bot: 6 preguntas (escala 1-5)
Usuario: Responde cada una
Bot: Agradece y cierra
```

---

## API Endpoints

| Endpoint                | Metodo   | Descripcion                 |
| ----------------------- | -------- | --------------------------- |
| `/api/whatsapp-webhook` | GET      | Verificacion del webhook    |
| `/api/whatsapp-webhook` | POST     | Recibe mensajes de WhatsApp |
| `/api/ticket-resolve`   | POST     | Marca ticket como resuelto  |
| `/api/admin-cache`      | GET/POST | Administracion de cache     |
| `/api/health`           | GET      | Health check del sistema    |

Ver [API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md) para documentacion completa.

---

## Tests

```bash
# Ejecutar todos los tests
npm test

# Tests con coverage
npm run test:coverage

# Tests por categoria
npm run test:unit         # Tests unitarios
npm run test:integration  # Tests de integracion
npm run test:flows        # Tests de flujos de conversacion

# Tests en modo watch
npm run test:watch
```

**Cobertura actual:** 458 tests pasando

---

## Deployment

### Azure Functions

```bash
# 1. Login en Azure
az login

# 2. Crear recursos (primera vez)
./scripts/deploy-azure.sh setup

# 3. Deploy
func azure functionapp publish func-acfixbot-prod
```

Ver [GUIA_DEPLOYMENT.md](./docs/GUIA_DEPLOYMENT.md) para instrucciones detalladas.

---

## Documentacion

| Documento                                                                       | Descripcion                              |
| ------------------------------------------------------------------------------- | ---------------------------------------- |
| [ARQUITECTURA_Y_RECURSOS.md](./docs/ARQUITECTURA_Y_RECURSOS.md)                 | Arquitectura completa y recursos Azure   |
| [ADR-001-DECISIONES-ARQUITECTURA.md](./docs/ADR-001-DECISIONES-ARQUITECTURA.md) | Decisiones arquitectonicas (Redis, etc.) |
| [API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md)                             | Documentacion de endpoints               |
| [GUIA_CONFIGURACION.md](./docs/GUIA_CONFIGURACION.md)                           | Configuracion de variables de entorno    |
| [GUIA_PERSONALIZACION.md](./docs/GUIA_PERSONALIZACION.md)                       | Como personalizar mensajes y flujos      |
| [GUIA_DEPLOYMENT.md](./docs/GUIA_DEPLOYMENT.md)                                 | Deployment a Azure                       |
| [GUIA_OPERACION.md](./docs/GUIA_OPERACION.md)                                   | Monitoreo y troubleshooting              |

---

## Stack Tecnologico

| Componente    | Tecnologia            |
| ------------- | --------------------- |
| Runtime       | Node.js 22            |
| Framework     | Azure Functions v4    |
| Base de datos | Azure SQL Server      |
| IA/NLP        | Gemini / Azure OpenAI |
| OCR           | Azure Computer Vision |
| Mensajeria    | WhatsApp Business API |
| Validacion    | Zod                   |
| Testing       | Jest                  |
| Linting       | ESLint + Prettier     |

---

## Costos Estimados

| Recurso                  | Costo Mensual       |
| ------------------------ | ------------------- |
| Azure SQL (S0)           | ~$15                |
| Azure Functions          | ~$3-5               |
| Computer Vision          | ~$3                 |
| IA (Gemini/Azure OpenAI) | ~$2                 |
| Storage                  | ~$2                 |
| **Total**                | **~$30-35 USD/mes** |

_Basado en 100 reportes/dia (~3,000/mes)_

---

## Contribucion

1. Fork el repositorio
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m 'Add: nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

### Convenciones

- **Commits:** Prefijos `Add:`, `Fix:`, `Update:`, `Remove:`
- **Codigo:** ESLint + Prettier (ejecutar `npm run lint:fix` antes de commit)
- **Tests:** Mantener cobertura minima del 80%

---

## Licencia

ISC - Arca Continental

---

## Soporte

Para soporte tecnico, contactar al equipo de desarrollo de AC FixBot.

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
