# Guia de Migracion: POC a Produccion

## Resumen de Cambios

Este documento describe los cambios realizados para migrar AC FixBot de POC a un entorno de desarrollo/produccion.

---

## 1. Cambios de Nombre

| Antes          | Despues       |
| -------------- | ------------- |
| `acfixbot-poc` | `acfixbot`    |
| Version 2.0.0  | Version 2.1.0 |

---

## 2. Estructura de Ambientes

### Ramas Git

```
main     → Produccion (solo merge con aprobacion)
staging  → Testing (Azure cliente)
develop  → Desarrollo (tu Azure)
```

### Configuraciones

```
scripts/azure/environments/
├── dev.env   # Desarrollo (~$15-25/mes)
├── tst.env   # Testing (~$15-25/mes)
└── prod.env  # Produccion (~$150-250/mes)
```

---

## 3. Seguridad

### Key Vault Service

Nuevo archivo: `core/services/infrastructure/keyVaultService.js`

```javascript
const keyVault = require('./keyVaultService');

// En produccion, los secretos se cargan de Key Vault
await keyVault.initializeSecrets();
```

### Secretos a Configurar en Key Vault

```
WHATSAPP-TOKEN
WHATSAPP-APP-SECRET
SQL-CONNECTION-STRING
AZURE-OPENAI-KEY
VISION-KEY
ADMIN-API-KEY
```

---

## 4. APIs Consolidadas

### Antes (6 functions)

- api-admin-cache
- api-metrics
- api-ticket-resolve
- api-conversations
- api-health
- api-whatsapp-webhook

### Despues (4 functions)

- **api-admin** (consolidado)
  - `/api/admin/cache`
  - `/api/admin/metrics`
  - `/api/admin/tickets/resolve`
- api-conversations
- api-health
- api-whatsapp-webhook

---

## 5. SQL Scripts Consolidados

### Antes (12+ archivos)

- install_complete.sql
- migrations/003*\*.sql - migrations/009*\*.sql
- cleanup-database.sql
- fix_ai_vision_states.sql

### Despues (1 archivo)

- `install-full-database.sql` - Schema completo consolidado

---

## 6. Tests Reorganizados

```
tests/
├── unit/           # 27 tests
├── integration/    # 5 tests
├── e2e/            # 2 tests (incluye encuestaFlow)
├── resilience/     # 1 test (antes chaos/)
├── security/       # 1 test
├── contracts/      # 1 test
├── load/           # Artillery configs
└── manual/         # Smoke tests
```

---

## 7. CI/CD (GitHub Actions)

### Workflows

- `ci.yml` - Tests, linting, seguridad en cada PR
- `deploy.yml` - Deploy automatico por rama
- `codeql.yml` - Analisis de seguridad
- `deploy-frontend.yml` - Static Web App

### Secrets Requeridos en GitHub

```
AZURE_CREDENTIALS_DEV   # Service Principal para DEV
AZURE_CREDENTIALS_TST   # Service Principal para TST
AZURE_CREDENTIALS_PROD  # Service Principal para PROD
```

### Crear Service Principal

```bash
az ad sp create-for-rbac --name "acfixbot-github-dev" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/rg-acfixbot-dev \
  --sdk-auth
```

---

## 8. Dependencias Actualizadas

| Paquete               | Antes  | Despues |
| --------------------- | ------ | ------- |
| @google/generative-ai | 0.21.0 | 0.24.1  |
| axios                 | 1.6.8  | 1.13.4  |
| openai                | 6.16.0 | 6.18.0  |
| ogg-opus-decoder      | 1.6.14 | 1.7.3   |

### Nuevas Dependencias

- `@azure/identity` - Autenticacion Azure
- `@azure/keyvault-secrets` - Key Vault

---

## 9. Pasos Post-Migracion

### Inmediato (Seguridad)

1. [ ] Rotar TODAS las credenciales expuestas
2. [ ] Configurar Key Vault en cada ambiente
3. [ ] Subir secretos a Key Vault

### Configurar GitHub

1. [ ] Crear environments: `dev`, `tst`, `prod`
2. [ ] Agregar reviewers requeridos para `prod`
3. [ ] Agregar secrets de Azure

### Deploy Inicial

```bash
# 1. Cargar ambiente
source scripts/azure/environments/dev.env

# 2. Deploy infraestructura
./scripts/azure/deploy-infrastructure.sh

# 3. Deploy database
./scripts/azure/init-database.sh

# 4. Deploy function app
./scripts/azure/deploy-function.sh
```

---

## 10. SKUs por Ambiente

| Recurso         | Dev          | Tst          | Prod         |
| --------------- | ------------ | ------------ | ------------ |
| SQL Database    | Basic        | Basic        | S1           |
| Function App    | Consumption  | Consumption  | Premium EP1  |
| Storage         | Standard_LRS | Standard_LRS | Standard_GRS |
| App Insights    | Free         | Free         | Standard     |
| Computer Vision | F0           | S1           | S1           |

---

## Contacto

Para dudas sobre la migracion, revisar:

- `docs/GUIA_DEPLOYMENT.md`
- `scripts/azure/environments/README.md`
