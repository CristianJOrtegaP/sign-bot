# Configuraciones por Ambiente

Esta carpeta contiene las configuraciones base para cada ambiente.

## Ambientes

| Archivo    | Ambiente   | Azure          | Uso                     |
| ---------- | ---------- | -------------- | ----------------------- |
| `dev.env`  | Desarrollo | Tu suscripcion | Desarrollo local y CI   |
| `tst.env`  | Testing    | Cliente        | QA y pruebas de usuario |
| `prod.env` | Produccion | Cliente        | Ambiente productivo     |

## Uso Rapido

```bash
# Deploy completo a dev (infraestructura + secretos + DB + codigo)
./scripts/azure/deploy.sh dev

# Solo validar que Bicep compila y es valido
./scripts/azure/deploy.sh dev --validate

# Preview de cambios sin desplegar
./scripts/azure/deploy.sh dev --what-if

# Solo infraestructura + secretos
./scripts/azure/deploy.sh tst --infra-only

# Solo codigo (re-deploy rapido)
./scripts/azure/deploy.sh prod --code-only

# Solo base de datos
./scripts/azure/deploy.sh dev --db-only

# Solo poblar Key Vault
./scripts/azure/deploy.sh dev --secrets-only

# Destruir ambiente
./scripts/azure/destroy.sh dev
```

## Antes del Primer Deploy

1. Copiar config.env.example a config.env
2. Configurar los secretos en config.env
3. Ejecutar deploy.sh

```bash
cp scripts/azure/config.env.example scripts/azure/config.env
# Editar config.env con tus secretos
./scripts/azure/deploy.sh dev
```

Si no configuras config.env, el script te pedira los secretos interactivamente.

## Infraestructura (Bicep IaC)

El script usa templates Bicep en `infra/` para crear toda la infraestructura declarativamente:

| Recurso          | DEV            | TST          | PROD         |
| ---------------- | -------------- | ------------ | ------------ |
| App Service Plan | Consumption Y1 | Premium EP1  | Premium EP1  |
| SQL Database     | Basic (5 DTU)  | S1 (20 DTU)  | S2 (50 DTU)  |
| Storage          | Standard_LRS   | Standard_LRS | Standard_GRS |
| Redis            | Omitido        | Basic C0     | Standard C1  |
| Service Bus      | Omitido        | Basic        | Standard     |
| App Insights     | 30 dias        | 60 dias      | 90 dias      |
| Computer Vision  | S1             | S1           | S1           |
| Speech Services  | F0 (gratis)    | F0           | F0           |
| Azure OpenAI     | S0             | S0           | S0           |
| Azure Maps       | Gen2           | Gen2         | Gen2         |
| Static Web App   | Free           | Free         | Free         |

## Key Vault Secrets (auto-poblados)

El script extrae automaticamente las keys de los recursos desplegados y las guarda en Key Vault:

| Secreto                       | Fuente                     |
| ----------------------------- | -------------------------- |
| SQL-CONNECTION-STRING         | Construido de parametros   |
| WHATSAPP-TOKEN                | config.env                 |
| WHATSAPP-VERIFY-TOKEN         | config.env / auto-generado |
| COMPUTER-VISION-KEY           | Extraido del recurso       |
| SPEECH-SERVICE-KEY            | Extraido del recurso       |
| AZURE-MAPS-KEY                | Extraido del recurso       |
| AZURE-OPENAI-API-KEY          | Extraido del recurso       |
| AZURE-OPENAI-ENDPOINT         | Extraido del recurso       |
| REDIS-CONNECTION-STRING       | Extraido (solo tst/prod)   |
| SERVICE-BUS-CONNECTION-STRING | Extraido (solo tst/prod)   |

## Costo Estimado Mensual

- **Dev**: ~$30-50 USD (todos los servicios basicos)
- **Tst**: ~$80-120 USD (con Redis y Service Bus)
- **Prod**: ~$150-250 USD (SKUs de produccion)

## Notas

- Los archivos `.env` en esta carpeta son plantillas de infra
- Los secretos reales van en `config.env` (ignorado por git)
- Despues del deploy, los secretos se guardan en Azure Key Vault
- Los nombres de recursos siguen la convencion de `infra/modules/naming.bicep`
