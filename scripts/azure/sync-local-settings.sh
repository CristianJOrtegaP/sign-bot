#!/bin/bash
# ============================================================================
# AC FIXBOT - Sincronizar local.settings.json
# ============================================================================
# Actualiza local.settings.json con las credenciales de los recursos
# creados en Azure (para desarrollo local)
# Nota: Para desarrollo local se usan valores directos, no Key Vault references
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_SETTINGS="$PROJECT_ROOT/local.settings.json"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ----------------------------------------------------------------------------
# CARGAR CONFIGURACION
# ----------------------------------------------------------------------------

load_config() {
    # Cargar deployment-output.env si existe
    if [ -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        log_info "Cargando configuracion de deployment-output.env..."
        source "${SCRIPT_DIR}/deployment-output.env"
    else
        log_warning "deployment-output.env no encontrado, usando config.env..."
    fi

    # Cargar config.env para variables adicionales
    if [ -f "${SCRIPT_DIR}/config.env" ]; then
        source "${SCRIPT_DIR}/config.env"
    else
        log_error "config.env no encontrado"
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# OBTENER CREDENCIALES DE AZURE
# ----------------------------------------------------------------------------

fetch_azure_credentials() {
    log_info "Obteniendo credenciales de Azure..."

    # Verificar login
    if ! az account show &> /dev/null; then
        log_error "No hay sesion activa en Azure. Ejecuta 'az login'"
        exit 1
    fi

    # Si no tenemos SQL_CONNECTION_STRING, construirla
    if [ -z "$SQL_CONNECTION_STRING" ]; then
        # Buscar SQL Server
        SQL_SERVER_FOUND=$(az sql server list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
        if [ -n "$SQL_SERVER_FOUND" ]; then
            SQL_SERVER_NAME="$SQL_SERVER_FOUND"
            SQL_SERVER_FQDN="${SQL_SERVER_NAME}.database.windows.net"
            SQL_CONNECTION_STRING="Server=tcp:${SQL_SERVER_FQDN},1433;Initial Catalog=${SQL_DATABASE_NAME};Persist Security Info=False;User ID=${SQL_ADMIN_USER};Password=${SQL_ADMIN_PASSWORD};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"
            log_success "SQL Connection String generado"
        fi
    fi

    # Si no tenemos VISION_ENDPOINT, obtenerlo
    if [ -z "$VISION_ENDPOINT" ] || [ -z "$VISION_KEY" ]; then
        CV_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='ComputerVision'].name" -o tsv 2>/dev/null)
        if [ -n "$CV_NAME" ]; then
            VISION_ENDPOINT=$(az cognitiveservices account show --name "$CV_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv)
            VISION_KEY=$(az cognitiveservices account keys list --name "$CV_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv)
            log_success "Computer Vision credentials obtenidos"
        fi
    fi

    # Si no tenemos BLOB_CONNECTION_STRING, obtenerlo
    if [ -z "$BLOB_CONNECTION_STRING" ]; then
        # Buscar storage account (excluir el de functions que tiene nombre diferente)
        STORAGE_NAME=$(az storage account list --resource-group "$RESOURCE_GROUP" --query "[?starts_with(name, 'stacfixbot')].name" -o tsv 2>/dev/null | head -1)
        if [ -n "$STORAGE_NAME" ]; then
            BLOB_CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv)
            log_success "Blob Connection String obtenido"
        fi
    fi
}

# ----------------------------------------------------------------------------
# ACTUALIZAR LOCAL.SETTINGS.JSON
# ----------------------------------------------------------------------------

update_local_settings() {
    log_info "Actualizando $LOCAL_SETTINGS..."

    # Verificar que existe el archivo
    if [ ! -f "$LOCAL_SETTINGS" ]; then
        log_warning "local.settings.json no existe, creando uno nuevo..."
        cat > "$LOCAL_SETTINGS" << 'EOF'
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": ""
  }
}
EOF
    fi

    # Crear archivo temporal con los nuevos valores
    TEMP_FILE=$(mktemp)

    # Usar node para actualizar el JSON (más seguro que sed/jq)
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$LOCAL_SETTINGS', 'utf8'));

// Actualizar valores
const updates = {
    'SQL_CONNECTION_STRING': process.env.SQL_CONNECTION_STRING || '',
    'VISION_ENDPOINT': process.env.VISION_ENDPOINT || '',
    'VISION_KEY': process.env.VISION_KEY || '',
    'BLOB_CONNECTION_STRING': process.env.BLOB_CONNECTION_STRING || '',
    'WHATSAPP_TOKEN': process.env.WHATSAPP_TOKEN || settings.Values.WHATSAPP_TOKEN || '',
    'WHATSAPP_PHONE_ID': process.env.WHATSAPP_PHONE_ID || settings.Values.WHATSAPP_PHONE_ID || '',
    'WHATSAPP_VERIFY_TOKEN': process.env.WHATSAPP_VERIFY_TOKEN || settings.Values.WHATSAPP_VERIFY_TOKEN || '',
    'GEMINI_API_KEY': process.env.GEMINI_API_KEY || settings.Values.GEMINI_API_KEY || '',
    'USE_AI': process.env.USE_AI || settings.Values.USE_AI || 'true',
    'AI_PROVIDER': process.env.AI_PROVIDER || settings.Values.AI_PROVIDER || 'gemini',
    'AZURE_OPENAI_ENDPOINT': process.env.AZURE_OPENAI_ENDPOINT || settings.Values.AZURE_OPENAI_ENDPOINT || '',
    'AZURE_OPENAI_KEY': process.env.AZURE_OPENAI_KEY || settings.Values.AZURE_OPENAI_KEY || '',
    'AZURE_OPENAI_DEPLOYMENT': process.env.AZURE_OPENAI_DEPLOYMENT || settings.Values.AZURE_OPENAI_DEPLOYMENT || '',
    'SESSION_TIMEOUT_MINUTES': process.env.SESSION_TIMEOUT_MINUTES || settings.Values.SESSION_TIMEOUT_MINUTES || '30',
    'SESSION_WARNING_MINUTES': process.env.SESSION_WARNING_MINUTES || settings.Values.SESSION_WARNING_MINUTES || '25',
    'KEY_VAULT_URI': process.env.KEY_VAULT_URI || settings.Values.KEY_VAULT_URI || '',
    'SURVEY_TIMER_SCHEDULE': process.env.SURVEY_TIMER_SCHEDULE || settings.Values.SURVEY_TIMER_SCHEDULE || '0 0 9 * * *',
    'SURVEY_MINUTOS_ESPERA': process.env.SURVEY_MINUTOS_ESPERA || settings.Values.SURVEY_MINUTOS_ESPERA || '24',
    'SURVEY_HORAS_EXPIRACION': process.env.SURVEY_HORAS_EXPIRACION || settings.Values.SURVEY_HORAS_EXPIRACION || '72'
};

// Solo actualizar valores que no estén vacíos
for (const [key, value] of Object.entries(updates)) {
    if (value) {
        settings.Values[key] = value;
    }
}

// Asegurar que existan los valores base de Azure Functions
settings.Values.FUNCTIONS_WORKER_RUNTIME = 'node';
if (!settings.Values.AzureWebJobsStorage) {
    settings.Values.AzureWebJobsStorage = '';
}

fs.writeFileSync('$TEMP_FILE', JSON.stringify(settings, null, 2));
console.log('OK');
" 2>/dev/null

    if [ $? -eq 0 ]; then
        mv "$TEMP_FILE" "$LOCAL_SETTINGS"
        log_success "local.settings.json actualizado"
    else
        rm -f "$TEMP_FILE"
        log_error "Error al actualizar local.settings.json"
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# MOSTRAR RESUMEN
# ----------------------------------------------------------------------------

show_summary() {
    echo ""
    echo "============================================================================"
    echo "  Valores actualizados en local.settings.json"
    echo "============================================================================"
    echo ""

    # Mostrar valores (ocultando secrets parcialmente)
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$LOCAL_SETTINGS', 'utf8'));

const mask = (val) => {
    if (!val || val.length < 10) return val || '(no configurado)';
    return val.substring(0, 15) + '...' + val.substring(val.length - 5);
};

console.log('  SQL_CONNECTION_STRING:', mask(settings.Values.SQL_CONNECTION_STRING));
console.log('  VISION_ENDPOINT:', settings.Values.VISION_ENDPOINT || '(no configurado)');
console.log('  VISION_KEY:', mask(settings.Values.VISION_KEY));
console.log('  BLOB_CONNECTION_STRING:', mask(settings.Values.BLOB_CONNECTION_STRING));
console.log('  WHATSAPP_TOKEN:', mask(settings.Values.WHATSAPP_TOKEN));
console.log('  WHATSAPP_PHONE_ID:', settings.Values.WHATSAPP_PHONE_ID || '(no configurado)');
console.log('  WHATSAPP_VERIFY_TOKEN:', settings.Values.WHATSAPP_VERIFY_TOKEN || '(no configurado)');
console.log('  GEMINI_API_KEY:', mask(settings.Values.GEMINI_API_KEY));
console.log('  USE_AI:', settings.Values.USE_AI || '(no configurado)');
console.log('');
console.log('  === Encuestas ===');
console.log('  SURVEY_TIMER_SCHEDULE:', settings.Values.SURVEY_TIMER_SCHEDULE || '(no configurado)');
console.log('  SURVEY_MINUTOS_ESPERA:', settings.Values.SURVEY_MINUTOS_ESPERA || '(no configurado)');
console.log('  SURVEY_HORAS_EXPIRACION:', settings.Values.SURVEY_HORAS_EXPIRACION || '(no configurado)');
"
    echo ""
}

# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Sincronizar local.settings.json"
    echo "============================================================================"
    echo ""

    load_config
    fetch_azure_credentials

    # Exportar variables para que node las pueda leer
    export SQL_CONNECTION_STRING
    export VISION_ENDPOINT
    export VISION_KEY
    export BLOB_CONNECTION_STRING
    export WHATSAPP_TOKEN
    export WHATSAPP_PHONE_ID
    export WHATSAPP_VERIFY_TOKEN
    export GEMINI_API_KEY
    export USE_AI
    export AI_PROVIDER
    export AZURE_OPENAI_ENDPOINT
    export AZURE_OPENAI_KEY
    export AZURE_OPENAI_DEPLOYMENT
    export SESSION_TIMEOUT_MINUTES
    export SESSION_WARNING_MINUTES
    export KEY_VAULT_URI
    export SURVEY_TIMER_SCHEDULE
    export SURVEY_MINUTOS_ESPERA
    export SURVEY_HORAS_EXPIRACION

    update_local_settings
    show_summary

    echo "============================================================================"
    echo -e "  ${GREEN}SINCRONIZACION COMPLETADA${NC}"
    echo "============================================================================"
    echo ""
    echo "  Ahora puedes ejecutar localmente con:"
    echo "    npm start"
    echo "  o"
    echo "    func start"
    echo ""
}

main "$@"
