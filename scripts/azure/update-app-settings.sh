#!/bin/bash
# ============================================================================
# AC FIXBOT - Actualizar App Settings
# ============================================================================
# Script para actualizar variables de entorno de la Function App
# sin necesidad de re-crear la infraestructura
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Cargar configuracion
load_config() {
    if [ -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        source "${SCRIPT_DIR}/deployment-output.env"
    fi

    if [ -f "${SCRIPT_DIR}/config.env" ]; then
        source "${SCRIPT_DIR}/config.env"
    fi

    if [ -z "$FUNCTION_APP_NAME" ] || [ -z "$RESOURCE_GROUP" ]; then
        log_error "FUNCTION_APP_NAME o RESOURCE_GROUP no definidos"
        log_info "Ejecuta primero deploy-infrastructure.sh"
        exit 1
    fi
}

# Mostrar settings actuales
show_current_settings() {
    log_info "Settings actuales de $FUNCTION_APP_NAME:"
    echo ""

    az functionapp config appsettings list \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "[?!starts_with(name, 'FUNCTIONS_') && !starts_with(name, 'WEBSITE_') && !starts_with(name, 'AzureWebJobs')].{name:name, value:value}" \
        --output table
}

# Actualizar un setting individual
update_setting() {
    local KEY=$1
    local VALUE=$2

    log_info "Actualizando $KEY..."

    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings "$KEY=$VALUE" \
        --output none

    log_success "$KEY actualizado"
}

# Actualizar todos los settings desde config.env
update_all_from_config() {
    log_info "Actualizando todos los settings desde config.env..."

    SETTINGS=()

    # WhatsApp
    [ -n "$WHATSAPP_TOKEN" ] && SETTINGS+=("WHATSAPP_TOKEN=$WHATSAPP_TOKEN")
    [ -n "$WHATSAPP_PHONE_ID" ] && SETTINGS+=("WHATSAPP_PHONE_ID=$WHATSAPP_PHONE_ID")
    [ -n "$WHATSAPP_VERIFY_TOKEN" ] && SETTINGS+=("WHATSAPP_VERIFY_TOKEN=$WHATSAPP_VERIFY_TOKEN")

    # IA Provider
    [ -n "$AI_PROVIDER" ] && SETTINGS+=("AI_PROVIDER=$AI_PROVIDER")
    [ -n "$USE_AI" ] && SETTINGS+=("USE_AI=$USE_AI")

    # Gemini
    [ -n "$GEMINI_API_KEY" ] && SETTINGS+=("GEMINI_API_KEY=$GEMINI_API_KEY")

    # Azure OpenAI
    [ -n "$AZURE_OPENAI_ENDPOINT" ] && SETTINGS+=("AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT")
    [ -n "$AZURE_OPENAI_KEY" ] && SETTINGS+=("AZURE_OPENAI_KEY=$AZURE_OPENAI_KEY")
    [ -n "$AZURE_OPENAI_DEPLOYMENT" ] && SETTINGS+=("AZURE_OPENAI_DEPLOYMENT=$AZURE_OPENAI_DEPLOYMENT")

    # Sesiones
    [ -n "$SESSION_TIMEOUT_MINUTES" ] && SETTINGS+=("SESSION_TIMEOUT_MINUTES=$SESSION_TIMEOUT_MINUTES")
    [ -n "$SESSION_WARNING_MINUTES" ] && SETTINGS+=("SESSION_WARNING_MINUTES=$SESSION_WARNING_MINUTES")

    # Encuestas de satisfaccion
    [ -n "$SURVEY_TIMER_SCHEDULE" ] && SETTINGS+=("SURVEY_TIMER_SCHEDULE=$SURVEY_TIMER_SCHEDULE")
    [ -n "$SURVEY_MINUTOS_ESPERA" ] && SETTINGS+=("SURVEY_MINUTOS_ESPERA=$SURVEY_MINUTOS_ESPERA")
    [ -n "$SURVEY_HORAS_EXPIRACION" ] && SETTINGS+=("SURVEY_HORAS_EXPIRACION=$SURVEY_HORAS_EXPIRACION")

    if [ ${#SETTINGS[@]} -eq 0 ]; then
        log_warning "No hay settings para actualizar en config.env"
        return
    fi

    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings "${SETTINGS[@]}" \
        --output none

    log_success "Settings actualizados: ${#SETTINGS[@]} variables"
}

# Menu interactivo
show_menu() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Actualizar App Settings"
    echo "============================================================================"
    echo ""
    echo "  === WhatsApp ==="
    echo "  1. Ver settings actuales"
    echo "  2. Actualizar WHATSAPP_TOKEN"
    echo "  3. Actualizar WHATSAPP_PHONE_ID"
    echo "  4. Actualizar WHATSAPP_VERIFY_TOKEN"
    echo ""
    echo "  === IA Provider ==="
    echo "  5. Cambiar AI_PROVIDER (gemini/azure-openai)"
    echo "  6. Actualizar USE_AI (true/false)"
    echo "  7. Actualizar GEMINI_API_KEY"
    echo "  8. Actualizar AZURE_OPENAI_ENDPOINT"
    echo "  9. Actualizar AZURE_OPENAI_KEY"
    echo "  10. Actualizar AZURE_OPENAI_DEPLOYMENT"
    echo ""
    echo "  === Encuestas ==="
    echo "  13. Actualizar SURVEY_TIMER_SCHEDULE"
    echo "  14. Actualizar SURVEY_MINUTOS_ESPERA"
    echo "  15. Actualizar SURVEY_HORAS_EXPIRACION"
    echo ""
    echo "  === Otros ==="
    echo "  11. Actualizar todos desde config.env"
    echo "  12. Actualizar setting personalizado"
    echo "  0. Salir"
    echo ""
    read -p "Selecciona una opcion: " OPTION

    case $OPTION in
        1) show_current_settings ;;
        2)
            read -p "WHATSAPP_TOKEN: " VALUE
            update_setting "WHATSAPP_TOKEN" "$VALUE"
            ;;
        3)
            read -p "WHATSAPP_PHONE_ID: " VALUE
            update_setting "WHATSAPP_PHONE_ID" "$VALUE"
            ;;
        4)
            read -p "WHATSAPP_VERIFY_TOKEN: " VALUE
            update_setting "WHATSAPP_VERIFY_TOKEN" "$VALUE"
            ;;
        5)
            echo "Opciones: gemini, azure-openai"
            read -p "AI_PROVIDER: " VALUE
            update_setting "AI_PROVIDER" "$VALUE"
            ;;
        6)
            read -p "USE_AI (true/false): " VALUE
            update_setting "USE_AI" "$VALUE"
            ;;
        7)
            read -p "GEMINI_API_KEY: " VALUE
            update_setting "GEMINI_API_KEY" "$VALUE"
            ;;
        8)
            read -p "AZURE_OPENAI_ENDPOINT: " VALUE
            update_setting "AZURE_OPENAI_ENDPOINT" "$VALUE"
            ;;
        9)
            read -p "AZURE_OPENAI_KEY: " VALUE
            update_setting "AZURE_OPENAI_KEY" "$VALUE"
            ;;
        10)
            read -p "AZURE_OPENAI_DEPLOYMENT: " VALUE
            update_setting "AZURE_OPENAI_DEPLOYMENT" "$VALUE"
            ;;
        11) update_all_from_config ;;
        12)
            read -p "Nombre del setting: " KEY
            read -p "Valor: " VALUE
            update_setting "$KEY" "$VALUE"
            ;;
        13)
            echo "Formato CRON: segundo minuto hora dia mes dia-semana"
            echo "Ejemplo: 0 0 9 * * * (9:00 AM diario)"
            read -p "SURVEY_TIMER_SCHEDULE: " VALUE
            update_setting "SURVEY_TIMER_SCHEDULE" "$VALUE"
            ;;
        14)
            echo "Horas de espera despues de resolucion (default: 24)"
            read -p "SURVEY_MINUTOS_ESPERA: " VALUE
            update_setting "SURVEY_MINUTOS_ESPERA" "$VALUE"
            ;;
        15)
            echo "Horas para expirar encuestas sin respuesta (default: 72)"
            read -p "SURVEY_HORAS_EXPIRACION: " VALUE
            update_setting "SURVEY_HORAS_EXPIRACION" "$VALUE"
            ;;
        0)
            log_info "Saliendo..."
            exit 0
            ;;
        *)
            log_warning "Opcion no valida"
            ;;
    esac

    # Mostrar menu de nuevo
    show_menu
}

# Main
main() {
    load_config

    # Verificar Azure CLI
    if ! az account show &> /dev/null; then
        log_warning "No hay sesion activa en Azure. Iniciando login..."
        az login
    fi

    log_success "Function App: $FUNCTION_APP_NAME"
    log_success "Resource Group: $RESOURCE_GROUP"

    # Si se pasa --list, solo mostrar settings
    if [[ "$1" == "--list" ]]; then
        show_current_settings
        exit 0
    fi

    # Si se pasa --sync, actualizar desde config.env
    if [[ "$1" == "--sync" ]]; then
        update_all_from_config
        exit 0
    fi

    # Si se pasan KEY=VALUE, actualizar directamente
    if [[ "$1" == *"="* ]]; then
        for setting in "$@"; do
            KEY="${setting%%=*}"
            VALUE="${setting#*=}"
            update_setting "$KEY" "$VALUE"
        done
        exit 0
    fi

    # Mostrar menu interactivo
    show_menu
}

main "$@"
