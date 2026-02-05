#!/bin/bash
# ============================================================================
# AC FIXBOT - Deploy Completo
# ============================================================================
# Script unico para desplegar toda la infraestructura y codigo
#
# Uso:
#   ./deploy.sh [ambiente]          # Deploy completo
#   ./deploy.sh dev --infra-only    # Solo infraestructura
#   ./deploy.sh tst --code-only     # Solo codigo
#   ./deploy.sh prod --db-only      # Solo base de datos
#
# Ambientes: dev, tst, prod
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

# ============================================================================
# CONFIGURACION
# ============================================================================

ENVIRONMENT="${1:-dev}"
INFRA_ONLY=false
CODE_ONLY=false
DB_ONLY=false

# Parsear flags
for arg in "$@"; do
    case $arg in
        --infra-only) INFRA_ONLY=true ;;
        --code-only) CODE_ONLY=true ;;
        --db-only) DB_ONLY=true ;;
        -y|--yes) AUTO_YES=true ;;
    esac
done

load_environment() {
    ENV_FILE="${SCRIPT_DIR}/environments/${ENVIRONMENT}.env"

    if [ ! -f "$ENV_FILE" ]; then
        log_error "Ambiente '$ENVIRONMENT' no existe"
        log_info "Ambientes disponibles: dev, tst, prod"
        exit 1
    fi

    source "$ENV_FILE"

    # Cargar config.env si existe (contiene secretos)
    if [ -f "${SCRIPT_DIR}/config.env" ]; then
        source "${SCRIPT_DIR}/config.env"
    fi

    log_ok "Ambiente cargado: $ENVIRONMENT"
}

check_prerequisites() {
    log_step "Verificando prerequisitos"

    # Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI no instalado"
        log_info "Instalar: https://docs.microsoft.com/cli/azure/install-azure-cli"
        exit 1
    fi
    log_ok "Azure CLI"

    # Login
    if ! az account show &> /dev/null; then
        log_warn "No hay sesion Azure, iniciando login..."
        az login
    fi

    ACCOUNT=$(az account show --query name -o tsv)
    log_ok "Conectado: $ACCOUNT"

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js no instalado"
        exit 1
    fi
    log_ok "Node.js $(node --version)"
}

# ============================================================================
# INFRAESTRUCTURA
# ============================================================================

# Defaults para ENABLE_* (se pueden sobreescribir en ambiente)
: "${ENABLE_SQL:=true}"
: "${ENABLE_STORAGE:=true}"
: "${ENABLE_COMPUTER_VISION:=true}"
: "${ENABLE_KEY_VAULT:=true}"
: "${ENABLE_APP_INSIGHTS:=true}"
: "${ENABLE_AZURE_SPEECH:=true}"
: "${ENABLE_AZURE_MAPS:=true}"
: "${ENABLE_STATIC_WEBAPP:=true}"
: "${ENABLE_AZURE_OPENAI:=true}"
: "${ENABLE_FUNCTION_APP:=true}"

create_infrastructure() {
    log_step "Creando infraestructura Azure"

    # Resource Group (siempre se crea)
    log_info "Resource Group: $RESOURCE_GROUP"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" \
        --tags project=acfixbot environment=$ENVIRONMENT \
        --output none 2>/dev/null || log_warn "Ya existe"
    log_ok "Resource Group"

    # SQL Server + Database
    if [ "${ENABLE_SQL}" = "true" ]; then
        log_info "SQL Server: $SQL_SERVER_NAME"
        if ! az sql server show --name "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az sql server create \
                --name "$SQL_SERVER_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$LOCATION" \
                --admin-user "${SQL_ADMIN_USER:-acfixbotadmin}" \
                --admin-password "$SQL_ADMIN_PASSWORD" \
                --output none

            # Firewall
            az sql server firewall-rule create \
                --name "AllowAzure" \
                --resource-group "$RESOURCE_GROUP" \
                --server "$SQL_SERVER_NAME" \
                --start-ip-address 0.0.0.0 \
                --end-ip-address 0.0.0.0 \
                --output none 2>/dev/null || true
        fi
        log_ok "SQL Server"

        log_info "SQL Database: $SQL_DATABASE_NAME"
        if ! az sql db show --name "$SQL_DATABASE_NAME" --server "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az sql db create \
                --name "$SQL_DATABASE_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --server "$SQL_SERVER_NAME" \
                --edition "${SQL_EDITION:-Basic}" \
                --capacity "${SQL_CAPACITY:-5}" \
                --output none
        fi
        log_ok "SQL Database"
    else
        log_warn "SQL: DESHABILITADO"
    fi

    # Storage Account
    if [ "${ENABLE_STORAGE}" = "true" ]; then
        log_info "Storage: $STORAGE_ACCOUNT_NAME"
        if ! az storage account show --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az storage account create \
                --name "$STORAGE_ACCOUNT_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$LOCATION" \
                --sku "${STORAGE_SKU:-Standard_LRS}" \
                --output none
        fi
        log_ok "Storage"
    else
        log_warn "Storage: DESHABILITADO"
    fi

    # Computer Vision
    if [ "${ENABLE_COMPUTER_VISION}" = "true" ]; then
        CV_LOCATION="${LOCATION}"
        [[ "$LOCATION" == "mexicocentral" ]] && CV_LOCATION="southcentralus"

        log_info "Computer Vision: $COMPUTER_VISION_NAME"
        if ! az cognitiveservices account show --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az cognitiveservices account create \
                --name "$COMPUTER_VISION_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --kind ComputerVision \
                --sku "${COMPUTER_VISION_SKU:-F0}" \
                --location "$CV_LOCATION" \
                --yes --output none 2>/dev/null || log_warn "Ya existe o requiere purge"
        fi
        log_ok "Computer Vision"
    else
        log_warn "Computer Vision: DESHABILITADO"
    fi

    # Application Insights
    if [ "${ENABLE_APP_INSIGHTS}" = "true" ]; then
        APP_INSIGHTS_NAME="appi-acfixbot-${ENVIRONMENT}"
        log_info "App Insights: $APP_INSIGHTS_NAME"
        if ! az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null 2>&1; then
            az monitor app-insights component create \
                --app "$APP_INSIGHTS_NAME" \
                --location "$LOCATION" \
                --resource-group "$RESOURCE_GROUP" \
                --kind web \
                --application-type Node.JS \
                --output none
        fi
        log_ok "App Insights"
    else
        log_warn "App Insights: DESHABILITADO"
    fi

    # Key Vault
    if [ "${ENABLE_KEY_VAULT}" = "true" ]; then
        KEY_VAULT_NAME="kv-acfixbot-${ENVIRONMENT}"
        log_info "Key Vault: $KEY_VAULT_NAME"
        if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null 2>&1; then
            az keyvault create \
                --name "$KEY_VAULT_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$LOCATION" \
                --enable-rbac-authorization false \
                --output none 2>/dev/null || log_warn "Ya existe o requiere purge"
        fi
        log_ok "Key Vault"
    else
        log_warn "Key Vault: DESHABILITADO"
    fi

    # Speech Services (para transcripcion de audios)
    if [ "${ENABLE_AZURE_SPEECH}" = "true" ]; then
        SPEECH_NAME="speech-acfixbot-${ENVIRONMENT}"
        SPEECH_LOCATION="${LOCATION}"
        [[ "$LOCATION" == "mexicocentral" ]] && SPEECH_LOCATION="southcentralus"

        log_info "Speech Services: $SPEECH_NAME"
        if ! az cognitiveservices account show --name "$SPEECH_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            # Intentar F0 (gratis) primero, si falla usar S0
            az cognitiveservices account create \
                --name "$SPEECH_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --kind SpeechServices \
                --sku F0 \
                --location "$SPEECH_LOCATION" \
                --yes --output none 2>/dev/null || \
            az cognitiveservices account create \
                --name "$SPEECH_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --kind SpeechServices \
                --sku S0 \
                --location "$SPEECH_LOCATION" \
                --yes --output none 2>/dev/null || log_warn "Ya existe o requiere purge"
        fi
        log_ok "Speech Services"
    else
        log_warn "Speech Services: DESHABILITADO"
    fi

    # Azure Maps (geocodificacion y rutas)
    if [ "${ENABLE_AZURE_MAPS}" = "true" ]; then
        MAPS_NAME="maps-acfixbot-${ENVIRONMENT}"
        log_info "Azure Maps: $MAPS_NAME"
        if ! az maps account show --name "$MAPS_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az maps account create \
                --name "$MAPS_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --sku G2 \
                --kind Gen2 \
                --accept-tos \
                --output none 2>/dev/null || log_warn "Ya existe"
        fi
        log_ok "Azure Maps"
    else
        log_warn "Azure Maps: DESHABILITADO"
    fi

    # Azure OpenAI (para Whisper y GPT)
    if [ "${ENABLE_AZURE_OPENAI}" = "true" ]; then
        AOAI_NAME="aoai-acfixbot-${ENVIRONMENT}"
        AOAI_LOCATION="${AZURE_OPENAI_LOCATION:-eastus}"  # OpenAI tiene disponibilidad limitada

        log_info "Azure OpenAI: $AOAI_NAME"
        if ! az cognitiveservices account show --name "$AOAI_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az cognitiveservices account create \
                --name "$AOAI_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --kind OpenAI \
                --sku S0 \
                --location "$AOAI_LOCATION" \
                --yes --output none 2>/dev/null || log_warn "Ya existe o requiere aprobacion"
        fi
        log_ok "Azure OpenAI"

        # Deploy modelo Whisper si no existe
        if [ "${ENABLE_WHISPER_MODEL}" = "true" ]; then
            WHISPER_DEPLOYMENT="whisper"
            log_info "Desplegando modelo Whisper..."
            az cognitiveservices account deployment create \
                --name "$AOAI_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --deployment-name "$WHISPER_DEPLOYMENT" \
                --model-name "whisper" \
                --model-version "001" \
                --model-format OpenAI \
                --sku-capacity 1 \
                --sku-name "Standard" \
                --output none 2>/dev/null || log_warn "Ya existe o no disponible"
            log_ok "Modelo Whisper"
        fi
    else
        log_warn "Azure OpenAI: DESHABILITADO"
    fi

    # Static Web App (dashboard)
    if [ "${ENABLE_STATIC_WEBAPP}" = "true" ]; then
        SWA_NAME="swa-acfixbot-${ENVIRONMENT}"
        SWA_LOCATION="westus2"  # SWA tiene disponibilidad limitada
        log_info "Static Web App: $SWA_NAME"
        if ! az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null 2>&1; then
            az staticwebapp create \
                --name "$SWA_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$SWA_LOCATION" \
                --sku Free \
                --output none 2>/dev/null || log_warn "Ya existe"
        fi
        log_ok "Static Web App"
    else
        log_warn "Static Web App: DESHABILITADO"
    fi

    # Function App
    if [ "${ENABLE_FUNCTION_APP}" = "true" ]; then
        log_info "Function App: $FUNCTION_APP_NAME"
        if ! az functionapp show --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
            az functionapp create \
                --name "$FUNCTION_APP_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --storage-account "$STORAGE_ACCOUNT_NAME" \
                --consumption-plan-location "$LOCATION" \
                --runtime node \
                --runtime-version 22 \
                --functions-version 4 \
                --os-type Linux \
                --output none 2>/dev/null || \
            az functionapp create \
                --name "$FUNCTION_APP_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --storage-account "$STORAGE_ACCOUNT_NAME" \
                --consumption-plan-location "southcentralus" \
                --runtime node \
                --runtime-version 22 \
                --functions-version 4 \
                --os-type Linux \
                --output none
        fi
        log_ok "Function App"

        # Managed Identity
        log_info "Habilitando Managed Identity..."
        PRINCIPAL_ID=$(az functionapp identity assign \
            --name "$FUNCTION_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --query principalId -o tsv)

        sleep 10

        # Key Vault access
        if [ "${ENABLE_KEY_VAULT}" = "true" ]; then
            az keyvault set-policy \
                --name "$KEY_VAULT_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --object-id "$PRINCIPAL_ID" \
                --secret-permissions get list \
                --output none 2>/dev/null || true
        fi
        log_ok "Managed Identity configurado"
    else
        log_warn "Function App: DESHABILITADO"
    fi

    # Guardar outputs
    save_outputs
}

save_outputs() {
    KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv 2>/dev/null)
    VISION_ENDPOINT=$(az cognitiveservices account show --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null)
    APP_INSIGHTS_KEY=$(az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" --query instrumentationKey -o tsv 2>/dev/null)
    SWA_URL=$(az staticwebapp show --name "swa-acfixbot-${ENVIRONMENT}" --resource-group "$RESOURCE_GROUP" --query defaultHostname -o tsv 2>/dev/null)

    cat > "${SCRIPT_DIR}/outputs-${ENVIRONMENT}.env" << EOF
# Auto-generated: $(date)
ENVIRONMENT="$ENVIRONMENT"
RESOURCE_GROUP="$RESOURCE_GROUP"
FUNCTION_APP_NAME="$FUNCTION_APP_NAME"
SQL_SERVER_FQDN="${SQL_SERVER_NAME}.database.windows.net"
SQL_DATABASE_NAME="$SQL_DATABASE_NAME"
KEY_VAULT_NAME="$KEY_VAULT_NAME"
KEY_VAULT_URI="$KEY_VAULT_URI"
VISION_ENDPOINT="$VISION_ENDPOINT"
APP_INSIGHTS_KEY="$APP_INSIGHTS_KEY"
FUNCTION_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
WEBHOOK_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
DASHBOARD_URL="https://${SWA_URL}"
EOF

    log_ok "Outputs guardados: outputs-${ENVIRONMENT}.env"
}

# ============================================================================
# BASE DE DATOS
# ============================================================================

init_database() {
    log_step "Inicializando base de datos"

    SQL_SCRIPT="$PROJECT_ROOT/sql-scripts/install-full-database.sql"

    if [ ! -f "$SQL_SCRIPT" ]; then
        log_error "Script SQL no encontrado: $SQL_SCRIPT"
        exit 1
    fi

    # Buscar sqlcmd
    SQLCMD=""
    for path in "sqlcmd" "/opt/mssql-tools18/bin/sqlcmd" "/opt/mssql-tools/bin/sqlcmd"; do
        if command -v "$path" &>/dev/null || [ -f "$path" ]; then
            SQLCMD="$path"
            break
        fi
    done

    if [ -z "$SQLCMD" ]; then
        log_error "sqlcmd no encontrado"
        log_info "Instalar: brew install mssql-tools18 (macOS)"
        log_info "O ejecutar el SQL manualmente en Azure Portal"
        return 1
    fi

    log_info "Ejecutando script SQL..."
    "$SQLCMD" -S "${SQL_SERVER_NAME}.database.windows.net" \
        -d "$SQL_DATABASE_NAME" \
        -U "${SQL_ADMIN_USER:-acfixbotadmin}" \
        -P "$SQL_ADMIN_PASSWORD" \
        -i "$SQL_SCRIPT" \
        -C -l 30 || {
            log_error "Error ejecutando SQL"
            return 1
        }

    log_ok "Base de datos inicializada"
}

# ============================================================================
# DEPLOY CODIGO
# ============================================================================

deploy_code() {
    log_step "Desplegando codigo"

    cd "$PROJECT_ROOT"

    # Instalar dependencias
    log_info "Instalando dependencias..."
    npm ci --omit=dev --silent

    # Crear ZIP
    log_info "Creando paquete..."
    DEPLOY_ZIP="/tmp/acfixbot-deploy.zip"
    rm -f "$DEPLOY_ZIP"

    zip -r "$DEPLOY_ZIP" . \
        -x "*.git*" \
        -x "tests/*" \
        -x "docs/*" \
        -x "scripts/*" \
        -x "sql-scripts/*" \
        -x "*.md" \
        -x ".env*" \
        -x "coverage/*" \
        -x ".vscode/*" \
        -x ".cursor/*" \
        -x ".claude/*" \
        > /dev/null

    DEPLOY_SIZE=$(du -h "$DEPLOY_ZIP" | cut -f1)
    log_info "Paquete: $DEPLOY_SIZE"

    # Deploy
    log_info "Subiendo a Azure..."
    az functionapp deployment source config-zip \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --src "$DEPLOY_ZIP" \
        --build-remote true \
        --timeout 600 \
        --output none

    rm -f "$DEPLOY_ZIP"
    log_ok "Codigo desplegado"
}

configure_app_settings() {
    log_step "Configurando App Settings"

    KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv)
    VISION_ENDPOINT=$(az cognitiveservices account show --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null)
    APP_INSIGHTS_KEY=$(az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" --query instrumentationKey -o tsv 2>/dev/null)
    APP_INSIGHTS_CONN=$(az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv 2>/dev/null)

    # Guardar secretos en Key Vault
    log_info "Guardando secretos en Key Vault..."

    SQL_CONNECTION_STRING="Server=tcp:${SQL_SERVER_NAME}.database.windows.net,1433;Initial Catalog=${SQL_DATABASE_NAME};Persist Security Info=False;User ID=${SQL_ADMIN_USER:-acfixbotadmin};Password=${SQL_ADMIN_PASSWORD};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

    az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "SQL-CONNECTION-STRING" --value "$SQL_CONNECTION_STRING" --output none 2>/dev/null || true

    VISION_KEY=$(az cognitiveservices account keys list --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null)
    [ -n "$VISION_KEY" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "VISION-KEY" --value "$VISION_KEY" --output none 2>/dev/null || true

    [ -n "$WHATSAPP_TOKEN" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "WHATSAPP-TOKEN" --value "$WHATSAPP_TOKEN" --output none 2>/dev/null || true
    [ -n "$GEMINI_API_KEY" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "GEMINI-API-KEY" --value "$GEMINI_API_KEY" --output none 2>/dev/null || true

    # Speech Services key
    if [ "${ENABLE_AZURE_SPEECH}" = "true" ]; then
        SPEECH_NAME="speech-acfixbot-${ENVIRONMENT}"
        SPEECH_KEY=$(az cognitiveservices account keys list --name "$SPEECH_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null)
        [ -n "$SPEECH_KEY" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-SPEECH-KEY" --value "$SPEECH_KEY" --output none 2>/dev/null || true
    fi

    # Azure Maps key
    if [ "${ENABLE_AZURE_MAPS}" = "true" ]; then
        MAPS_NAME="maps-acfixbot-${ENVIRONMENT}"
        MAPS_KEY=$(az maps account keys list --name "$MAPS_NAME" --resource-group "$RESOURCE_GROUP" --query primaryKey -o tsv 2>/dev/null)
        [ -n "$MAPS_KEY" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-MAPS-KEY" --value "$MAPS_KEY" --output none 2>/dev/null || true
    fi

    # Azure OpenAI key
    if [ "${ENABLE_AZURE_OPENAI}" = "true" ]; then
        AOAI_NAME="aoai-acfixbot-${ENVIRONMENT}"
        AOAI_KEY=$(az cognitiveservices account keys list --name "$AOAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null)
        AOAI_ENDPOINT=$(az cognitiveservices account show --name "$AOAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null)
        [ -n "$AOAI_KEY" ] && az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-OPENAI-KEY" --value "$AOAI_KEY" --output none 2>/dev/null || true
    fi

    # Configurar Function App
    log_info "Configurando Function App..."

    SETTINGS=(
        "KEY_VAULT_URI=$KEY_VAULT_URI"
        "AI_PROVIDER=${AI_PROVIDER:-gemini}"
        "USE_AI=${USE_AI:-true}"
    )

    # SQL
    if [ "${ENABLE_SQL}" = "true" ]; then
        SETTINGS+=("SQL_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/SQL-CONNECTION-STRING/)")
    fi

    # Computer Vision
    if [ "${ENABLE_COMPUTER_VISION}" = "true" ]; then
        SETTINGS+=("VISION_ENDPOINT=$VISION_ENDPOINT")
        SETTINGS+=("VISION_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/VISION-KEY/)")
    fi

    # App Insights
    if [ "${ENABLE_APP_INSIGHTS}" = "true" ]; then
        SETTINGS+=("APPINSIGHTS_INSTRUMENTATIONKEY=$APP_INSIGHTS_KEY")
        SETTINGS+=("APPLICATIONINSIGHTS_CONNECTION_STRING=$APP_INSIGHTS_CONN")
    fi

    # WhatsApp
    [ -n "$WHATSAPP_TOKEN" ] && SETTINGS+=("WHATSAPP_TOKEN=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/WHATSAPP-TOKEN/)")
    [ -n "$WHATSAPP_PHONE_ID" ] && SETTINGS+=("WHATSAPP_PHONE_ID=$WHATSAPP_PHONE_ID")
    [ -n "$GEMINI_API_KEY" ] && SETTINGS+=("GEMINI_API_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/GEMINI-API-KEY/)")

    # Speech Services (transcripcion de audios)
    if [ "${ENABLE_AZURE_SPEECH}" = "true" ]; then
        SPEECH_LOCATION="${LOCATION}"
        [[ "$LOCATION" == "mexicocentral" ]] && SPEECH_LOCATION="southcentralus"
        SETTINGS+=("AZURE_SPEECH_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-SPEECH-KEY/)")
        SETTINGS+=("AZURE_SPEECH_REGION=$SPEECH_LOCATION")
        SETTINGS+=("AUDIO_TRANSCRIPTION_ENABLED=${AUDIO_TRANSCRIPTION_ENABLED:-true}")
    fi

    # Azure Maps (rutas y geocodificacion)
    if [ "${ENABLE_AZURE_MAPS}" = "true" ]; then
        SETTINGS+=("AZURE_MAPS_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-MAPS-KEY/)")
    fi

    # Azure OpenAI
    if [ "${ENABLE_AZURE_OPENAI}" = "true" ]; then
        SETTINGS+=("AZURE_OPENAI_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AZURE-OPENAI-KEY/)")
        SETTINGS+=("AZURE_OPENAI_ENDPOINT=$AOAI_ENDPOINT")
        [ -n "${AZURE_OPENAI_DEPLOYMENT}" ] && SETTINGS+=("AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}")
    fi

    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings "${SETTINGS[@]}" \
        --output none

    log_ok "App Settings configurados"
}

verify_deployment() {
    log_step "Verificando deployment"

    FUNCTION_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"

    log_info "Esperando 30s para que la app inicie..."
    sleep 30

    # Health check
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${FUNCTION_URL}/api/health" 2>/dev/null || echo "000")

    if [ "$RESPONSE" == "200" ]; then
        log_ok "Health check: OK"
    else
        log_warn "Health check: $RESPONSE (puede tardar unos minutos)"
    fi

    # Listar funciones
    log_info "Funciones desplegadas:"
    az functionapp function list \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --query "[].name" -o tsv 2>/dev/null || log_warn "No se pudieron listar"
}

show_summary() {
    SWA_URL=$(az staticwebapp show --name "swa-acfixbot-${ENVIRONMENT}" --resource-group "$RESOURCE_GROUP" --query defaultHostname -o tsv 2>/dev/null)

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}DEPLOY COMPLETADO${NC}"
    echo "============================================================================"
    echo ""
    echo "  Ambiente:     $ENVIRONMENT"
    echo "  Function App: https://${FUNCTION_APP_NAME}.azurewebsites.net"
    echo "  Webhook:      https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    [ -n "$SWA_URL" ] && echo "  Dashboard:    https://${SWA_URL}"
    echo ""
    echo "  Configurar WhatsApp:"
    echo "    1. https://developers.facebook.com"
    echo "    2. Tu App > WhatsApp > Configuration"
    echo "    3. Webhook URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo ""
    echo "  Ver logs:"
    echo "    az functionapp log tail --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Deploy a Azure"
    echo "============================================================================"
    echo ""

    load_environment
    check_prerequisites

    if [ "$CODE_ONLY" = true ]; then
        deploy_code
        verify_deployment
    elif [ "$INFRA_ONLY" = true ]; then
        create_infrastructure
        configure_app_settings
    elif [ "$DB_ONLY" = true ]; then
        init_database
    else
        create_infrastructure
        init_database
        configure_app_settings
        deploy_code
        verify_deployment
    fi

    show_summary
}

main "$@"
