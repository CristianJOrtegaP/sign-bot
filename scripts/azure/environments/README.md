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
# Deploy completo a dev
./scripts/azure/deploy.sh dev

# Solo infraestructura
./scripts/azure/deploy.sh tst --infra-only

# Solo codigo
./scripts/azure/deploy.sh prod --code-only

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

## Control de Recursos

Cada recurso se puede habilitar/deshabilitar con flags `ENABLE_*`:

| Flag                     | Descripcion                | Dev   | Tst   | Prod  |
| ------------------------ | -------------------------- | ----- | ----- | ----- |
| `ENABLE_SQL`             | Base de datos SQL          | true  | true  | true  |
| `ENABLE_STORAGE`         | Blob storage (fotos)       | true  | true  | true  |
| `ENABLE_COMPUTER_VISION` | OCR para fotos             | true  | true  | true  |
| `ENABLE_KEY_VAULT`       | Secretos                   | true  | true  | true  |
| `ENABLE_APP_INSIGHTS`    | Monitoreo                  | true  | true  | true  |
| `ENABLE_AZURE_SPEECH`    | Transcripcion audios       | true  | true  | true  |
| `ENABLE_AZURE_MAPS`      | Geocodificacion y rutas    | true  | true  | true  |
| `ENABLE_AZURE_OPENAI`    | Azure OpenAI (Whisper/GPT) | false | true  | true  |
| `ENABLE_WHISPER_MODEL`   | Desplegar modelo Whisper   | false | true  | true  |
| `ENABLE_STATIC_WEBAPP`   | Dashboard web              | true  | true  | true  |
| `ENABLE_FUNCTION_APP`    | Function App (backend)     | true  | true  | true  |
| `ENABLE_REDIS`           | Cache (>1000 usuarios/dia) | false | false | false |
| `ENABLE_SERVICEBUS`      | Colas (event-driven)       | false | false | false |

## SKUs por Ambiente

| Recurso         | Dev           | Tst           | Prod          |
| --------------- | ------------- | ------------- | ------------- |
| SQL Database    | Basic (5 DTU) | Basic (5 DTU) | Basic (5 DTU) |
| Function App    | Consumption   | Consumption   | Consumption   |
| Storage         | Standard_LRS  | Standard_LRS  | Standard_LRS  |
| Computer Vision | F0 (free)     | S1            | S1            |
| App Insights    | Free          | Free          | Free          |
| Azure OpenAI    | -             | S0            | S0            |

## Costo Estimado Mensual

- **Dev**: ~$15-25 USD (sin Azure OpenAI)
- **Tst**: ~$40-60 USD (con Azure OpenAI)
- **Prod**: ~$50-80 USD (optimizado para 100 reportes/dia)

## Notas

- Los archivos `.env` en esta carpeta son plantillas de infra
- Los secretos reales van en `config.env` (ignorado por git)
- Despues del deploy, los secretos se guardan en Azure Key Vault
