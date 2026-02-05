# Configuraciones por Ambiente

Esta carpeta contiene las configuraciones base para cada ambiente.

## Ambientes

| Archivo    | Ambiente   | Azure          | Uso                     |
| ---------- | ---------- | -------------- | ----------------------- |
| `dev.env`  | Desarrollo | Tu suscripcion | Desarrollo local y CI   |
| `tst.env`  | Testing    | Cliente        | QA y pruebas de usuario |
| `prod.env` | Produccion | Cliente        | Ambiente productivo     |

## Uso

```bash
# Cargar configuracion de ambiente
source scripts/azure/environments/dev.env

# Luego cargar secretos (config.env)
source scripts/azure/config.env

# Ejecutar deployment
./scripts/azure/deploy-infrastructure.sh
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

- Los archivos `.env` en esta carpeta son plantillas
- Los secretos reales van en `config.env` (ignorado por git)
- En produccion, usar Key Vault para todos los secretos
