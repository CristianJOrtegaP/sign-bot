#!/bin/bash
# ============================================================================
# AC FIXBOT - Deploy de Infraestructura Azure
# ============================================================================
# Este script crea todos los recursos necesarios en Azure:
# - Resource Group
# - SQL Server y Database
# - Storage Account
# - Computer Vision
# - Application Insights (para monitoreo y logs)
# - Key Vault (para secrets)
# - Function App (con Managed Identity)
# ============================================================================

set -e  # Salir si hay error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Obtener directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ----------------------------------------------------------------------------
# FUNCIONES DE UTILIDAD
# ----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_az_cli() {
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI no esta instalado. Instalar desde: https://docs.microsoft.com/cli/azure/install-azure-cli"
        exit 1
    fi
    log_success "Azure CLI encontrado"
}

check_az_login() {
    if ! az account show &> /dev/null; then
        log_warning "No hay sesion activa en Azure. Iniciando login..."
        az login
    fi
    ACCOUNT_NAME=$(az account show --query name -o tsv)
    log_success "Conectado a Azure: $ACCOUNT_NAME"
}


# ----------------------------------------------------------------------------
# CARGAR CONFIGURACION
# ----------------------------------------------------------------------------

load_config() {
    CONFIG_FILE="${SCRIPT_DIR}/config.env"

    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "Archivo de configuracion no encontrado: $CONFIG_FILE"
        log_info "Copia config.env.example a config.env y completa los valores"
        exit 1
    fi

    # Cargar variables
    source "$CONFIG_FILE"

    # Definir nombres de recursos usando el ambiente (poc, dev, tst, prd)
    # Los nombres ya vienen definidos en config.env con ${ENVIRONMENT}
    APP_INSIGHTS_NAME="appi-acfixbot-${ENVIRONMENT}"
    KEY_VAULT_NAME="kv-acfixbot-${ENVIRONMENT}"

    log_success "Configuracion cargada"
    log_info "Resource Group: $RESOURCE_GROUP"
    log_info "Location: $LOCATION"
    log_info "Environment: $ENVIRONMENT"
    log_info "SQL Server: $SQL_SERVER_NAME"
    log_info "Storage Account: $STORAGE_ACCOUNT_NAME"
    log_info "Function App: $FUNCTION_APP_NAME"
    log_info "Computer Vision: $COMPUTER_VISION_NAME"
    log_info "Application Insights: $APP_INSIGHTS_NAME"
    log_info "Key Vault: $KEY_VAULT_NAME"
}

# ----------------------------------------------------------------------------
# CREAR RESOURCE GROUP
# ----------------------------------------------------------------------------

create_resource_group() {
    log_info "Creando Resource Group: $RESOURCE_GROUP..."

    if az group show --name "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Resource Group ya existe, usando existente"
    else
        az group create \
            --name "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --tags "project=acfixbot" "environment=$ENVIRONMENT"
        log_success "Resource Group creado"
    fi
}

# ----------------------------------------------------------------------------
# CREAR SQL SERVER Y DATABASE
# ----------------------------------------------------------------------------

create_sql_server() {
    log_info "Creando SQL Server: $SQL_SERVER_NAME..."

    # Verificar si ya existe
    if az sql server show --name "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "SQL Server ya existe, usando existente"
    else
        az sql server create \
            --name "$SQL_SERVER_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --admin-user "$SQL_ADMIN_USER" \
            --admin-password "$SQL_ADMIN_PASSWORD"
        log_success "SQL Server creado"
    fi

    # Configurar firewall - Permitir servicios de Azure
    log_info "Configurando firewall de SQL Server..."
    az sql server firewall-rule create \
        --name "AllowAzureServices" \
        --resource-group "$RESOURCE_GROUP" \
        --server "$SQL_SERVER_NAME" \
        --start-ip-address 0.0.0.0 \
        --end-ip-address 0.0.0.0 \
        2>/dev/null || log_warning "Regla de firewall ya existe"

    # Agregar IP actual para desarrollo
    MY_IP=$(curl -s https://api.ipify.org)
    if [ -n "$MY_IP" ]; then
        log_info "Agregando IP actual ($MY_IP) al firewall..."
        az sql server firewall-rule create \
            --name "AllowMyIP" \
            --resource-group "$RESOURCE_GROUP" \
            --server "$SQL_SERVER_NAME" \
            --start-ip-address "$MY_IP" \
            --end-ip-address "$MY_IP" \
            2>/dev/null || log_warning "Regla de IP ya existe o no se pudo agregar"
    fi

    log_success "Firewall configurado"
}

create_sql_database() {
    log_info "Creando SQL Database: $SQL_DATABASE_NAME..."

    if az sql db show --name "$SQL_DATABASE_NAME" --server "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "SQL Database ya existe, usando existente"
    else
        az sql db create \
            --name "$SQL_DATABASE_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --server "$SQL_SERVER_NAME" \
            --edition "Basic" \
            --capacity 5 \
            --max-size "2GB"
        log_success "SQL Database creado"
    fi

    # Generar connection string
    SQL_CONNECTION_STRING="Server=tcp:${SQL_SERVER_NAME}.database.windows.net,1433;Initial Catalog=${SQL_DATABASE_NAME};Persist Security Info=False;User ID=${SQL_ADMIN_USER};Password=${SQL_ADMIN_PASSWORD};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

    log_success "Connection String generado"
}

# ----------------------------------------------------------------------------
# CREAR STORAGE ACCOUNT
# ----------------------------------------------------------------------------

create_storage_account() {
    log_info "Creando Storage Account: $STORAGE_ACCOUNT_NAME..."

    if az storage account show --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Storage Account ya existe, usando existente"
    else
        az storage account create \
            --name "$STORAGE_ACCOUNT_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --sku "${STORAGE_SKU:-Standard_LRS}" \
            --kind StorageV2 \
            --access-tier Hot
        log_success "Storage Account creado"
    fi

    # Obtener connection string
    BLOB_CONNECTION_STRING=$(az storage account show-connection-string \
        --name "$STORAGE_ACCOUNT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query connectionString -o tsv)

    # Crear container para imagenes
    log_info "Creando container 'imagenes'..."
    az storage container create \
        --name "imagenes" \
        --account-name "$STORAGE_ACCOUNT_NAME" \
        --public-access blob \
        2>/dev/null || log_warning "Container ya existe"

    log_success "Storage Account configurado"
}

# ----------------------------------------------------------------------------
# CREAR COMPUTER VISION
# ----------------------------------------------------------------------------

create_computer_vision() {
    log_info "Creando Computer Vision: $COMPUTER_VISION_NAME..."

    # Computer Vision no está disponible en todas las regiones
    # Usar región alternativa si es necesario
    CV_LOCATION="$LOCATION"
    CV_UNAVAILABLE_REGIONS="mexicocentral brazilsoutheast"

    if [[ "$CV_UNAVAILABLE_REGIONS" == *"$LOCATION"* ]]; then
        CV_LOCATION="southcentralus"  # Texas - región más cercana a México
        log_warning "Computer Vision no disponible en $LOCATION, usando $CV_LOCATION"
    fi

    # Verificar si ya existe
    if az cognitiveservices account show --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Computer Vision ya existe, usando existente"
    else
        # Verificar si existe soft-deleted y purgarlo
        if az cognitiveservices account list-deleted --query "[?name=='$COMPUTER_VISION_NAME']" -o tsv 2>/dev/null | grep -q "$COMPUTER_VISION_NAME"; then
            log_warning "Computer Vision soft-deleted encontrado, purgando..."
            az cognitiveservices account purge \
                --name "$COMPUTER_VISION_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$CV_LOCATION" 2>/dev/null || true
            log_success "Recurso purgado"
        fi

        az cognitiveservices account create \
            --name "$COMPUTER_VISION_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --kind ComputerVision \
            --sku "${COMPUTER_VISION_SKU:-S1}" \
            --location "$CV_LOCATION" \
            --yes
        log_success "Computer Vision creado en $CV_LOCATION"
    fi

    # Obtener endpoint y key
    VISION_ENDPOINT=$(az cognitiveservices account show \
        --name "$COMPUTER_VISION_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query properties.endpoint -o tsv)

    VISION_KEY=$(az cognitiveservices account keys list \
        --name "$COMPUTER_VISION_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query key1 -o tsv)

    log_success "Computer Vision configurado"
}

# ----------------------------------------------------------------------------
# CREAR AZURE OPENAI (Opcional - para producción)
# ----------------------------------------------------------------------------

create_azure_openai() {
    # Solo crear si ENABLE_AZURE_OPENAI está configurado
    if [ "${ENABLE_AZURE_OPENAI:-false}" != "true" ]; then
        log_info "Azure OpenAI deshabilitado (ENABLE_AZURE_OPENAI=false)"
        log_info "Para habilitar, agregar ENABLE_AZURE_OPENAI=\"true\" en config.env"
        return 0
    fi

    AZURE_OPENAI_NAME="${AZURE_OPENAI_NAME:-aoai-acfixbot-${ENVIRONMENT}}"

    log_info "Creando Azure OpenAI: $AZURE_OPENAI_NAME..."

    # Azure OpenAI tiene disponibilidad limitada por región
    # Regiones con mejor disponibilidad: eastus, eastus2, westus, westus2, swedencentral
    AOAI_LOCATION="${AZURE_OPENAI_LOCATION:-eastus}"

    # Verificar si ya existe
    if az cognitiveservices account show --name "$AZURE_OPENAI_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Azure OpenAI ya existe, usando existente"
    else
        # Verificar si existe soft-deleted y purgarlo
        if az cognitiveservices account list-deleted --query "[?name=='$AZURE_OPENAI_NAME']" -o tsv 2>/dev/null | grep -q "$AZURE_OPENAI_NAME"; then
            log_warning "Azure OpenAI soft-deleted encontrado, purgando..."
            az cognitiveservices account purge \
                --name "$AZURE_OPENAI_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$AOAI_LOCATION" 2>/dev/null || true
            sleep 10
        fi

        log_info "Creando recurso en $AOAI_LOCATION..."
        if ! az cognitiveservices account create \
            --name "$AZURE_OPENAI_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --kind "OpenAI" \
            --sku "S0" \
            --location "$AOAI_LOCATION" \
            --yes 2>&1; then
            log_warning "No se pudo crear Azure OpenAI. Posibles causas:"
            log_warning "  - Tu suscripción requiere aprobación: https://aka.ms/oai/access"
            log_warning "  - La región $AOAI_LOCATION no tiene disponibilidad"
            log_warning "Continuando sin Azure OpenAI..."
            return 0
        fi
        log_success "Azure OpenAI creado en $AOAI_LOCATION"
    fi

    # Configurar custom subdomain (requerido para que la API REST funcione)
    log_info "Configurando custom subdomain para Azure OpenAI..."
    az cognitiveservices account update \
        --name "$AZURE_OPENAI_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --custom-domain "$AZURE_OPENAI_NAME" \
        --output none 2>/dev/null || true
    log_success "Custom subdomain configurado: $AZURE_OPENAI_NAME.openai.azure.com"

    # Obtener endpoint (ahora con custom subdomain)
    AZURE_OPENAI_ENDPOINT=$(az cognitiveservices account show \
        --name "$AZURE_OPENAI_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query properties.endpoint -o tsv)

    AZURE_OPENAI_KEY=$(az cognitiveservices account keys list \
        --name "$AZURE_OPENAI_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query key1 -o tsv)

    # Crear deployment del modelo
    AZURE_OPENAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-4o-mini}"
    AZURE_OPENAI_MODEL="${AZURE_OPENAI_MODEL:-gpt-4o-mini}"

    log_info "Creando deployment del modelo: $AZURE_OPENAI_DEPLOYMENT..."

    # Verificar si el deployment ya existe
    if az cognitiveservices account deployment show \
        --name "$AZURE_OPENAI_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$AZURE_OPENAI_DEPLOYMENT" &> /dev/null 2>&1; then
        log_warning "Deployment ya existe, usando existente"
    else
        if az cognitiveservices account deployment create \
            --name "$AZURE_OPENAI_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --deployment-name "$AZURE_OPENAI_DEPLOYMENT" \
            --model-name "$AZURE_OPENAI_MODEL" \
            --model-version "2024-07-18" \
            --model-format "OpenAI" \
            --sku-capacity 10 \
            --sku-name "Standard" 2>&1; then
            log_success "Deployment $AZURE_OPENAI_DEPLOYMENT creado"
        else
            log_warning "No se pudo crear el deployment. El modelo puede no estar disponible."
            log_warning "Prueba con otro modelo: gpt-35-turbo, gpt-4o-mini"
        fi
    fi

    log_success "Azure OpenAI configurado"
    log_info "  Endpoint: $AZURE_OPENAI_ENDPOINT"
    log_info "  Deployment: $AZURE_OPENAI_DEPLOYMENT"

}

# ----------------------------------------------------------------------------
# CREAR RECURSO WHISPER (Azure OpenAI separado en North Central US)
# ----------------------------------------------------------------------------

create_whisper_resource() {
    # Solo crear si AUDIO_TRANSCRIPTION_ENABLED está habilitado
    if [[ "${AUDIO_TRANSCRIPTION_ENABLED:-false}" != "true" ]]; then
        log_info "Transcripción de audio deshabilitada (AUDIO_TRANSCRIPTION_ENABLED=false)"
        return 0
    fi

    AZURE_WHISPER_NAME="${AZURE_WHISPER_NAME:-aoai-acfixbot-whisper-${ENVIRONMENT}}"
    AZURE_WHISPER_LOCATION="${AZURE_WHISPER_LOCATION:-northcentralus}"
    AZURE_AUDIO_DEPLOYMENT="${AZURE_AUDIO_DEPLOYMENT:-whisper}"

    log_info "Creando Azure OpenAI para Whisper: $AZURE_WHISPER_NAME en $AZURE_WHISPER_LOCATION..."

    # Verificar si ya existe
    if az cognitiveservices account show --name "$AZURE_WHISPER_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Azure OpenAI Whisper ya existe, usando existente"
    else
        # Verificar si existe soft-deleted y purgarlo
        if az cognitiveservices account list-deleted --query "[?name=='$AZURE_WHISPER_NAME']" -o tsv 2>/dev/null | grep -q "$AZURE_WHISPER_NAME"; then
            log_warning "Azure OpenAI Whisper soft-deleted encontrado, purgando..."
            az cognitiveservices account purge \
                --name "$AZURE_WHISPER_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$AZURE_WHISPER_LOCATION" 2>/dev/null || true
            sleep 10
        fi

        log_info "Creando recurso Whisper en $AZURE_WHISPER_LOCATION..."
        if ! az cognitiveservices account create \
            --name "$AZURE_WHISPER_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --kind "OpenAI" \
            --sku "S0" \
            --location "$AZURE_WHISPER_LOCATION" \
            --yes 2>&1; then
            log_warning "No se pudo crear Azure OpenAI Whisper."
            log_warning "Continuando sin transcripción de audio..."
            return 0
        fi
        log_success "Azure OpenAI Whisper creado en $AZURE_WHISPER_LOCATION"
    fi

    # Configurar custom subdomain (requerido para que la API REST funcione)
    log_info "Configurando custom subdomain para Whisper..."
    az cognitiveservices account update \
        --name "$AZURE_WHISPER_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --custom-domain "$AZURE_WHISPER_NAME" \
        --output none 2>/dev/null || true
    log_success "Custom subdomain configurado: $AZURE_WHISPER_NAME.openai.azure.com"

    # Obtener endpoint y key
    AZURE_AUDIO_ENDPOINT=$(az cognitiveservices account show \
        --name "$AZURE_WHISPER_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query properties.endpoint -o tsv)

    AZURE_AUDIO_KEY=$(az cognitiveservices account keys list \
        --name "$AZURE_WHISPER_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query key1 -o tsv)

    # Crear deployment de Whisper
    log_info "Creando deployment de Whisper: $AZURE_AUDIO_DEPLOYMENT..."

    if az cognitiveservices account deployment show \
        --name "$AZURE_WHISPER_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$AZURE_AUDIO_DEPLOYMENT" &> /dev/null 2>&1; then
        log_warning "Deployment Whisper ya existe"
    else
        if az cognitiveservices account deployment create \
            --name "$AZURE_WHISPER_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --deployment-name "$AZURE_AUDIO_DEPLOYMENT" \
            --model-name "whisper" \
            --model-version "001" \
            --model-format "OpenAI" \
            --sku-capacity 1 \
            --sku-name "Standard" 2>&1; then
            log_success "Deployment Whisper creado"
        else
            log_warning "No se pudo crear deployment de Whisper"
        fi
    fi

    log_success "Azure OpenAI Whisper configurado"
    log_info "  Endpoint: $AZURE_AUDIO_ENDPOINT"
    log_info "  Deployment: $AZURE_AUDIO_DEPLOYMENT"
}

# ----------------------------------------------------------------------------
# CREAR AZURE MAPS (Geocodificacion y Rutas)
# ----------------------------------------------------------------------------

create_azure_maps() {
    AZURE_MAPS_NAME="${AZURE_MAPS_NAME:-maps-acfixbot-${ENVIRONMENT}}"

    log_info "Creando Azure Maps: $AZURE_MAPS_NAME..."

    # Verificar si ya existe
    if az maps account show --name "$AZURE_MAPS_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Azure Maps ya existe, usando existente"
    else
        az maps account create \
            --name "$AZURE_MAPS_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --sku "G2" \
            --kind "Gen2" \
            --accept-tos \
            --output none
        log_success "Azure Maps creado"
    fi

    # Obtener primary key
    AZURE_MAPS_KEY=$(az maps account keys list \
        --name "$AZURE_MAPS_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query primaryKey -o tsv)

    log_success "Azure Maps configurado"
}

# ----------------------------------------------------------------------------
# CREAR APPLICATION INSIGHTS
# ----------------------------------------------------------------------------

create_application_insights() {
    log_info "Creando Application Insights: $APP_INSIGHTS_NAME..."

    # Verificar si ya existe
    if az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null 2>&1; then
        log_warning "Application Insights ya existe, usando existente"
    else
        az monitor app-insights component create \
            --app "$APP_INSIGHTS_NAME" \
            --location "$LOCATION" \
            --resource-group "$RESOURCE_GROUP" \
            --kind web \
            --application-type Node.JS \
            --output none
        log_success "Application Insights creado"
    fi

    # Obtener instrumentation key y connection string
    APP_INSIGHTS_KEY=$(az monitor app-insights component show \
        --app "$APP_INSIGHTS_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query instrumentationKey -o tsv)

    APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
        --app "$APP_INSIGHTS_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query connectionString -o tsv)

    log_success "Application Insights configurado"
}

# ----------------------------------------------------------------------------
# CREAR KEY VAULT
# ----------------------------------------------------------------------------

create_key_vault() {
    log_info "Creando Key Vault: $KEY_VAULT_NAME..."

    # Verificar si ya existe
    if az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null 2>&1; then
        log_warning "Key Vault ya existe, usando existente"
    else
        # Verificar si existe soft-deleted y recuperarlo o purgarlo
        if az keyvault list-deleted --query "[?name=='$KEY_VAULT_NAME']" -o tsv 2>/dev/null | grep -q "$KEY_VAULT_NAME"; then
            log_warning "Key Vault soft-deleted encontrado, purgando..."
            az keyvault purge --name "$KEY_VAULT_NAME" --location "$LOCATION" 2>/dev/null || true
            sleep 10
        fi

        az keyvault create \
            --name "$KEY_VAULT_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --enable-rbac-authorization false \
            --enabled-for-template-deployment true \
            --output none
        log_success "Key Vault creado"
    fi

    # Obtener URI del Key Vault
    KEY_VAULT_URI=$(az keyvault show \
        --name "$KEY_VAULT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query properties.vaultUri -o tsv)

    log_success "Key Vault configurado: $KEY_VAULT_URI"
}

# ----------------------------------------------------------------------------
# GUARDAR SECRETS EN KEY VAULT
# ----------------------------------------------------------------------------

store_secrets_in_keyvault() {
    log_info "Guardando secrets en Key Vault..."

    # SQL Connection String
    az keyvault secret set \
        --vault-name "$KEY_VAULT_NAME" \
        --name "SQL-CONNECTION-STRING" \
        --value "$SQL_CONNECTION_STRING" \
        --output none 2>/dev/null || log_warning "Secret SQL ya existe, actualizando..."

    # Blob Connection String
    az keyvault secret set \
        --vault-name "$KEY_VAULT_NAME" \
        --name "BLOB-CONNECTION-STRING" \
        --value "$BLOB_CONNECTION_STRING" \
        --output none 2>/dev/null || log_warning "Secret BLOB ya existe, actualizando..."

    # Vision Key
    az keyvault secret set \
        --vault-name "$KEY_VAULT_NAME" \
        --name "VISION-KEY" \
        --value "$VISION_KEY" \
        --output none 2>/dev/null || log_warning "Secret VISION ya existe, actualizando..."

    # WhatsApp Token (si existe)
    if [ -n "$WHATSAPP_TOKEN" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "WHATSAPP-TOKEN" \
            --value "$WHATSAPP_TOKEN" \
            --output none 2>/dev/null || log_warning "Secret WHATSAPP-TOKEN ya existe, actualizando..."
    fi

    # WhatsApp Verify Token (si existe)
    if [ -n "$WHATSAPP_VERIFY_TOKEN" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "WHATSAPP-VERIFY-TOKEN" \
            --value "$WHATSAPP_VERIFY_TOKEN" \
            --output none 2>/dev/null || log_warning "Secret WHATSAPP-VERIFY-TOKEN ya existe, actualizando..."
    fi

    # WhatsApp App Secret (si existe - para verificar firma de webhooks)
    if [ -n "$WHATSAPP_APP_SECRET" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "WHATSAPP-APP-SECRET" \
            --value "$WHATSAPP_APP_SECRET" \
            --output none 2>/dev/null || log_warning "Secret WHATSAPP-APP-SECRET ya existe, actualizando..."
    fi

    # Gemini API Key (si existe)
    if [ -n "$GEMINI_API_KEY" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "GEMINI-API-KEY" \
            --value "$GEMINI_API_KEY" \
            --output none 2>/dev/null || log_warning "Secret GEMINI ya existe, actualizando..."
    fi

    # Azure OpenAI Key (si existe - creado por script o configurado manualmente)
    if [ -n "$AZURE_OPENAI_KEY" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "AZURE-OPENAI-KEY" \
            --value "$AZURE_OPENAI_KEY" \
            --output none 2>/dev/null || log_warning "Secret AZURE-OPENAI-KEY ya existe, actualizando..."
        log_success "Azure OpenAI Key guardado en Key Vault"
    fi

    # Azure Whisper Key (si existe - creado por create_whisper_resource)
    if [ -n "$AZURE_AUDIO_KEY" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "AZURE-WHISPER-KEY" \
            --value "$AZURE_AUDIO_KEY" \
            --output none 2>/dev/null || log_warning "Secret AZURE-WHISPER-KEY ya existe, actualizando..."
        log_success "Azure Whisper Key guardado en Key Vault"
    fi

    # Azure Maps Key (si existe)
    if [ -n "$AZURE_MAPS_KEY" ]; then
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "AZURE-MAPS-KEY" \
            --value "$AZURE_MAPS_KEY" \
            --output none 2>/dev/null || log_warning "Secret AZURE-MAPS-KEY ya existe, actualizando..."
        log_success "Azure Maps Key guardado en Key Vault"
    fi

    log_success "Secrets guardados en Key Vault"
}

# ----------------------------------------------------------------------------
# CREAR FUNCTION APP
# ----------------------------------------------------------------------------

create_function_app() {
    log_info "Creando Function App: $FUNCTION_APP_NAME..."

    # Verificar si ya existe
    if az functionapp show --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Function App ya existe, usando existente"
        return 0
    fi

    # Intentar crear en la región principal primero
    log_info "Intentando crear en $LOCATION con Node.js ${FUNCTION_RUNTIME_VERSION:-22}..."

    if az functionapp create \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --storage-account "$STORAGE_ACCOUNT_NAME" \
        --consumption-plan-location "$LOCATION" \
        --runtime "${FUNCTION_RUNTIME:-node}" \
        --runtime-version "${FUNCTION_RUNTIME_VERSION:-22}" \
        --functions-version 4 \
        --os-type Linux 2>/dev/null; then
        log_success "Function App creado en $LOCATION"
    else
        # Fallback a southcentralus si falla
        log_warning "No disponible en $LOCATION, intentando en southcentralus..."
        az functionapp create \
            --name "$FUNCTION_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --storage-account "$STORAGE_ACCOUNT_NAME" \
            --consumption-plan-location "southcentralus" \
            --runtime "${FUNCTION_RUNTIME:-node}" \
            --runtime-version "${FUNCTION_RUNTIME_VERSION:-22}" \
            --functions-version 4 \
            --os-type Linux
        log_success "Function App creado en southcentralus"
    fi
}

# ----------------------------------------------------------------------------
# CONFIGURAR APP SETTINGS
# ----------------------------------------------------------------------------

wait_for_function_app() {
    log_info "Esperando a que Function App esté listo..."
    local MAX_RETRIES=30
    local RETRY=0

    while [ $RETRY -lt $MAX_RETRIES ]; do
        if az functionapp show --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
            log_success "Function App está listo"
            return 0
        fi
        RETRY=$((RETRY + 1))
        log_info "Esperando... (intento $RETRY/$MAX_RETRIES)"
        sleep 5
    done

    log_error "Timeout esperando Function App"
    return 1
}

# ----------------------------------------------------------------------------
# HABILITAR MANAGED IDENTITY Y ACCESO A KEY VAULT
# ----------------------------------------------------------------------------

enable_managed_identity() {
    log_info "Habilitando Managed Identity en Function App..."

    # Habilitar System Assigned Managed Identity
    PRINCIPAL_ID=$(az functionapp identity assign \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query principalId -o tsv)

    if [ -z "$PRINCIPAL_ID" ]; then
        log_error "No se pudo obtener el Principal ID"
        return 1
    fi

    log_success "Managed Identity habilitado. Principal ID: $PRINCIPAL_ID"

    # Esperar un momento para que la identidad se propague
    log_info "Esperando propagación de identidad..."
    sleep 15

    # Otorgar permisos de lectura de secrets en Key Vault
    log_info "Otorgando permisos de Key Vault a Function App..."

    az keyvault set-policy \
        --name "$KEY_VAULT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --object-id "$PRINCIPAL_ID" \
        --secret-permissions get list \
        --output none

    log_success "Permisos de Key Vault configurados"
}

configure_app_settings() {
    # Esperar a que el Function App esté disponible
    wait_for_function_app

    log_info "Configurando variables de entorno en Function App..."

    # Usar Key Vault References para secrets sensibles
    # Sintaxis: @Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>/)

    # Construir array de settings con Key Vault references
    SETTINGS=(
        "SQL_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/SQL-CONNECTION-STRING/)"
        "BLOB_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/BLOB-CONNECTION-STRING/)"
        "VISION_ENDPOINT=$VISION_ENDPOINT"
        "VISION_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/VISION-KEY/)"
        "SESSION_TIMEOUT_MINUTES=${SESSION_TIMEOUT_MINUTES:-30}"
        "SESSION_WARNING_MINUTES=${SESSION_WARNING_MINUTES:-25}"
        "APPINSIGHTS_INSTRUMENTATIONKEY=$APP_INSIGHTS_KEY"
        "APPLICATIONINSIGHTS_CONNECTION_STRING=$APP_INSIGHTS_CONNECTION_STRING"
        "KEY_VAULT_URI=$KEY_VAULT_URI"
    )

    # Agregar WhatsApp settings - Token desde Key Vault, otros directos
    if [ -n "$WHATSAPP_TOKEN" ]; then
        SETTINGS+=("WHATSAPP_TOKEN=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/WHATSAPP-TOKEN/)")
    fi
    if [ -n "$WHATSAPP_PHONE_ID" ]; then
        SETTINGS+=("WHATSAPP_PHONE_ID=$WHATSAPP_PHONE_ID")
    fi
    if [ -n "$WHATSAPP_VERIFY_TOKEN" ]; then
        SETTINGS+=("WHATSAPP_VERIFY_TOKEN=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/WHATSAPP-VERIFY-TOKEN/)")
    fi
    if [ -n "$WHATSAPP_APP_SECRET" ]; then
        SETTINGS+=("WHATSAPP_APP_SECRET=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/WHATSAPP-APP-SECRET/)")
    fi

    # Agregar AI Provider setting
    # Si Azure OpenAI está configurado, usarlo como provider por defecto
    if [ -n "$AZURE_OPENAI_ENDPOINT" ]; then
        SETTINGS+=("AI_PROVIDER=azure-openai")
    else
        SETTINGS+=("AI_PROVIDER=${AI_PROVIDER:-gemini}")
    fi
    SETTINGS+=("USE_AI=${USE_AI:-true}")

    # Agregar Gemini settings - API Key desde Key Vault
    if [ -n "$GEMINI_API_KEY" ]; then
        SETTINGS+=("GEMINI_API_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/GEMINI-API-KEY/)")
    fi

    # Agregar Azure OpenAI settings (para produccion)
    if [ -n "$AZURE_OPENAI_ENDPOINT" ]; then
        SETTINGS+=("AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT")
    fi
    if [ -n "$AZURE_OPENAI_KEY" ]; then
        SETTINGS+=("AZURE_OPENAI_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-OPENAI-KEY/)")
    fi
    if [ -n "$AZURE_OPENAI_DEPLOYMENT" ]; then
        SETTINGS+=("AZURE_OPENAI_DEPLOYMENT=$AZURE_OPENAI_DEPLOYMENT")
    fi

    # Agregar settings de encuestas de satisfaccion
    SETTINGS+=("SURVEY_TIMER_SCHEDULE=${SURVEY_TIMER_SCHEDULE:-0 0 9 * * *}")
    SETTINGS+=("SURVEY_MINUTOS_ESPERA=${SURVEY_MINUTOS_ESPERA:-1440}")
    SETTINGS+=("SURVEY_HORAS_EXPIRACION=${SURVEY_HORAS_EXPIRACION:-72}")

    # Agregar Azure Maps settings (geocodificacion y rutas)
    if [ -n "$AZURE_MAPS_KEY" ]; then
        SETTINGS+=("AZURE_MAPS_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-MAPS-KEY/)")
    fi
    SETTINGS+=("ROUTE_BUFFER_MINUTES=${ROUTE_BUFFER_MINUTES:-20}")

    # Agregar settings de transcripcion de audio (Whisper en recurso separado)
    SETTINGS+=("AUDIO_TRANSCRIPTION_ENABLED=${AUDIO_TRANSCRIPTION_ENABLED:-false}")
    if [ -n "$AZURE_AUDIO_ENDPOINT" ]; then
        SETTINGS+=("AZURE_AUDIO_ENDPOINT=$AZURE_AUDIO_ENDPOINT")
    fi
    if [ -n "$AZURE_AUDIO_KEY" ]; then
        SETTINGS+=("AZURE_AUDIO_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-WHISPER-KEY/)")
    fi
    SETTINGS+=("AZURE_AUDIO_DEPLOYMENT=${AZURE_AUDIO_DEPLOYMENT:-whisper}")

    # Aplicar settings
    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings "${SETTINGS[@]}" \
        --output none

    log_success "Variables de entorno configuradas con Key Vault References"
}

# ----------------------------------------------------------------------------
# GUARDAR OUTPUTS
# ----------------------------------------------------------------------------

save_outputs() {
    OUTPUT_FILE="${SCRIPT_DIR}/deployment-output.env"

    cat > "$OUTPUT_FILE" << EOF
# ============================================================================
# AC FIXBOT - Outputs del Deployment
# Generado: $(date)
# ============================================================================

# Resource Group
RESOURCE_GROUP="$RESOURCE_GROUP"
LOCATION="$LOCATION"
ENVIRONMENT="$ENVIRONMENT"

# SQL Server
SQL_SERVER_NAME="$SQL_SERVER_NAME"
SQL_SERVER_FQDN="${SQL_SERVER_NAME}.database.windows.net"
SQL_DATABASE_NAME="$SQL_DATABASE_NAME"
SQL_ADMIN_USER="$SQL_ADMIN_USER"
SQL_CONNECTION_STRING="$SQL_CONNECTION_STRING"

# Storage Account
STORAGE_ACCOUNT_NAME="$STORAGE_ACCOUNT_NAME"
BLOB_CONNECTION_STRING="$BLOB_CONNECTION_STRING"

# Computer Vision
COMPUTER_VISION_NAME="$COMPUTER_VISION_NAME"
VISION_ENDPOINT="$VISION_ENDPOINT"
VISION_KEY="$VISION_KEY"

# Application Insights
APP_INSIGHTS_NAME="$APP_INSIGHTS_NAME"
APP_INSIGHTS_KEY="$APP_INSIGHTS_KEY"
APP_INSIGHTS_CONNECTION_STRING="$APP_INSIGHTS_CONNECTION_STRING"

# Key Vault
KEY_VAULT_NAME="$KEY_VAULT_NAME"
KEY_VAULT_URI="$KEY_VAULT_URI"

# Function App
FUNCTION_APP_NAME="$FUNCTION_APP_NAME"
FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
WEBHOOK_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"

# Azure OpenAI (si se creó)
AZURE_OPENAI_NAME="${AZURE_OPENAI_NAME:-}"
AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT:-}"
AZURE_OPENAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-}"

# Audio Transcription (usa GPT-4o-mini-audio en el mismo recurso de Azure OpenAI)
AZURE_AUDIO_DEPLOYMENT="${AZURE_AUDIO_DEPLOYMENT:-gpt-4o-mini-audio}"

# Azure Maps (geocodificacion y rutas)
AZURE_MAPS_NAME="${AZURE_MAPS_NAME:-}"
ROUTE_BUFFER_MINUTES="${ROUTE_BUFFER_MINUTES:-20}"

# ============================================================================
# PROXIMOS PASOS:
# ============================================================================
# 1. Ejecutar init-database.sh para crear las tablas
# 2. Ejecutar deploy-function.sh para subir el codigo
# 3. Configurar el webhook en Meta Business:
#    URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook
#    Verify Token: (el que configuraste en WHATSAPP_VERIFY_TOKEN)
# ============================================================================
EOF

    log_success "Outputs guardados en: $OUTPUT_FILE"
}

# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Deploy de Infraestructura Azure"
    echo "============================================================================"
    echo ""

    # Verificaciones
    check_az_cli
    check_az_login
    load_config

    echo ""
    echo "============================================================================"
    echo "  Creando recursos..."
    echo "============================================================================"
    echo ""

    # Crear recursos
    create_resource_group
    create_sql_server
    create_sql_database
    create_storage_account
    create_computer_vision
    create_azure_openai
    create_whisper_resource
    create_azure_maps
    create_application_insights
    create_key_vault
    create_function_app
    enable_managed_identity
    store_secrets_in_keyvault
    configure_app_settings
    save_outputs

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}DEPLOYMENT COMPLETADO${NC}"
    echo "============================================================================"
    echo ""
    echo "Recursos creados:"
    echo "  - Resource Group: $RESOURCE_GROUP"
    echo "  - SQL Server: ${SQL_SERVER_NAME}.database.windows.net"
    echo "  - SQL Database: $SQL_DATABASE_NAME"
    echo "  - Storage Account: $STORAGE_ACCOUNT_NAME"
    echo "  - Computer Vision: $COMPUTER_VISION_NAME"
    if [ -n "$AZURE_OPENAI_ENDPOINT" ]; then
        echo "  - Azure OpenAI: $AZURE_OPENAI_NAME (deployment: $AZURE_OPENAI_DEPLOYMENT)"
    fi
    if [ -n "$AZURE_AUDIO_ENDPOINT" ]; then
        echo "  - Azure Whisper: $AZURE_WHISPER_NAME (deployment: $AZURE_AUDIO_DEPLOYMENT)"
    fi
    if [ -n "$AZURE_MAPS_KEY" ]; then
        echo "  - Azure Maps: $AZURE_MAPS_NAME (geocoding + routing)"
    fi
    echo "  - Application Insights: $APP_INSIGHTS_NAME"
    echo "  - Key Vault: $KEY_VAULT_NAME"
    echo "  - Function App: $FUNCTION_APP_NAME (con Managed Identity)"
    echo ""
    echo "Key Vault URI: $KEY_VAULT_URI"
    if [ -n "$AZURE_OPENAI_ENDPOINT" ]; then
        echo "Azure OpenAI Endpoint: $AZURE_OPENAI_ENDPOINT"
    fi
    if [ -n "$AZURE_MAPS_KEY" ]; then
        echo "Azure Maps: Habilitado (buffer: ${ROUTE_BUFFER_MINUTES:-20} min)"
    fi
    echo "URL del Webhook: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo ""
    echo "Proximos pasos:"
    echo "  1. ./init-database.sh    - Crear tablas en la base de datos"
    echo "  2. ./deploy-function.sh  - Subir codigo de la Function App"
    echo ""
}

# Ejecutar
main "$@"
