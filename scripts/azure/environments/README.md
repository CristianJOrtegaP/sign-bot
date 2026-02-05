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

## SKUs por Ambiente

| Recurso         | Dev           | Tst           | Prod         |
| --------------- | ------------- | ------------- | ------------ |
| SQL Database    | Basic (5 DTU) | Basic (5 DTU) | S1 (20 DTU)  |
| Function App    | Consumption   | Consumption   | Premium EP1  |
| Storage         | Standard_LRS  | Standard_LRS  | Standard_GRS |
| Computer Vision | F0 (free)     | S1            | S1           |
| App Insights    | Free          | Free          | Standard     |

## Costo Estimado Mensual

- **Dev**: ~$15-25 USD
- **Tst**: ~$15-25 USD
- **Prod**: ~$150-250 USD

## Notas

- Los archivos `.env` en esta carpeta son plantillas de infra
- Los secretos reales van en `config.env` (ignorado por git)
- Despues del deploy, los secretos se guardan en Azure Key Vault
