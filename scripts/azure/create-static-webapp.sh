#!/bin/bash
# ============================================================================
# AC FIXBOT - Crear Azure Static Web App
# ============================================================================
# Este script crea una Azure Static Web App y la conecta con la Function App
# existente como Linked Backend.
#
# Requisitos:
# - Azure CLI instalado y logueado (az login)
# - config.env configurado
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cargar configuracion
if [ -f "$SCRIPT_DIR/config.env" ]; then
    source "$SCRIPT_DIR/config.env"
else
    echo "ERROR: No se encontro config.env"
    echo "Copia config.env.example a config.env y completa los valores"
    exit 1
fi

# Variables
SWA_NAME="swa-acfixbot-${ENVIRONMENT}"
SWA_LOCATION="westus2"  # Static Web Apps tiene disponibilidad limitada

echo "============================================"
echo "  AC FIXBOT - Crear Static Web App"
echo "============================================"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Static Web App: $SWA_NAME"
echo "  Function App:   $FUNCTION_APP_NAME"
echo "  Location:       $SWA_LOCATION"
echo "============================================"
echo ""

# Verificar Azure CLI
if ! command -v az &> /dev/null; then
    echo "ERROR: Azure CLI no esta instalado"
    exit 1
fi

# Verificar login
ACCOUNT=$(az account show --query name -o tsv 2>/dev/null || true)
if [ -z "$ACCOUNT" ]; then
    echo "ERROR: No estas logueado en Azure CLI"
    echo "Ejecuta: az login"
    exit 1
fi
echo "Cuenta de Azure: $ACCOUNT"
echo ""

# 1. Crear Static Web App
echo ">>> Creando Static Web App..."
az staticwebapp create \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$SWA_LOCATION" \
    --sku Free \
    --output none

echo "    Static Web App creada: $SWA_NAME"

# 2. Obtener URL de la Static Web App
SWA_URL=$(az staticwebapp show \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "defaultHostname" -o tsv)
echo "    URL: https://$SWA_URL"

# 3. Obtener Resource ID de la Function App
echo ""
echo ">>> Obteniendo Function App Resource ID..."
FUNCTION_APP_ID=$(az functionapp show \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query id -o tsv)

if [ -z "$FUNCTION_APP_ID" ]; then
    echo "ERROR: No se encontro la Function App: $FUNCTION_APP_NAME"
    exit 1
fi
echo "    Function App ID: $FUNCTION_APP_ID"

# 4. Vincular como Linked Backend
echo ""
echo ">>> Vinculando Function App como backend..."
az staticwebapp backends link \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --backend-resource-id "$FUNCTION_APP_ID" \
    --backend-region "$LOCATION" \
    --output none 2>/dev/null || echo "    (Backend ya vinculado o en proceso)"

echo "    Backend vinculado correctamente"

# 5. Obtener deployment token para GitHub Actions
echo ""
echo ">>> Obteniendo deployment token..."
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.apiKey" -o tsv)

echo ""
echo "============================================"
echo "  Static Web App Creada Exitosamente!"
echo "============================================"
echo ""
echo "  Dashboard URL: https://$SWA_URL"
echo ""
echo "  Deployment Token (guardar como secret en GitHub):"
echo "  AZURE_STATIC_WEB_APPS_API_TOKEN=$DEPLOYMENT_TOKEN"
echo ""
echo "  Siguiente paso:"
echo "  1. Agregar el token como secret en GitHub"
echo "  2. Push del codigo a GitHub"
echo "  3. El workflow de GitHub Actions desplegara automaticamente"
echo ""
echo "  Para configurar Easy Auth manualmente:"
echo "  - Ir a Azure Portal > Static Web App > Settings > Authentication"
echo "  - Add identity provider > Microsoft"
echo "  - Usar el mismo App Registration que la Function App"
echo ""
echo "============================================"

# Guardar token en archivo temporal (opcional)
echo "$DEPLOYMENT_TOKEN" > "$SCRIPT_DIR/.swa-deployment-token"
echo "Token guardado en: $SCRIPT_DIR/.swa-deployment-token"
echo "(Agregar este archivo a .gitignore)"
