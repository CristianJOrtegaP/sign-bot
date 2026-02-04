#!/bin/bash
# ============================================================================
# AC FIXBOT - Deploy Completo
# ============================================================================
# Script maestro que ejecuta todo el proceso de deployment:
# 1. Crear infraestructura en Azure
# 2. Inicializar base de datos
# 3. Deploy del codigo de la Function App
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Obtener directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${CYAN}========================================${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}========================================${NC}\n"; }

# ----------------------------------------------------------------------------
# VERIFICAR CONFIGURACION
# ----------------------------------------------------------------------------

check_config() {
    if [ ! -f "${SCRIPT_DIR}/config.env" ]; then
        log_error "Archivo config.env no encontrado"
        echo ""
        echo "Para comenzar:"
        echo "  1. Copia el archivo de ejemplo:"
        echo "     cp ${SCRIPT_DIR}/config.env.example ${SCRIPT_DIR}/config.env"
        echo ""
        echo "  2. Edita config.env con tus valores:"
        echo "     - SQL_ADMIN_PASSWORD (password seguro)"
        echo "     - WHATSAPP_TOKEN (de Meta Business)"
        echo "     - WHATSAPP_PHONE_ID (de Meta Business)"
        echo "     - WHATSAPP_VERIFY_TOKEN (tu token de verificacion)"
        echo "     - GEMINI_API_KEY (de Google AI Studio)"
        echo ""
        echo "  3. Ejecuta este script nuevamente"
        echo ""
        exit 1
    fi

    # Verificar password de SQL
    source "${SCRIPT_DIR}/config.env"
    if [[ "$SQL_ADMIN_PASSWORD" == "CAMBIAR_EN_PRODUCCION" ]] || [[ -z "$SQL_ADMIN_PASSWORD" ]]; then
        log_error "Debes configurar SQL_ADMIN_PASSWORD en config.env"
        exit 1
    fi

    log_success "Archivo de configuracion encontrado"
}

# ----------------------------------------------------------------------------
# MOSTRAR RESUMEN
# ----------------------------------------------------------------------------

show_summary() {
    source "${SCRIPT_DIR}/config.env"

    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Resumen de Deployment"
    echo "============================================================================"
    echo ""
    echo "  Resource Group:    $RESOURCE_GROUP"
    echo "  Location:          $LOCATION"
    echo "  Environment:       $ENVIRONMENT"
    echo ""
    echo "  SQL Server:        $SQL_SERVER_NAME"
    echo "  SQL Database:      $SQL_DATABASE_NAME"
    echo "  Storage Account:   $STORAGE_ACCOUNT_NAME"
    echo "  Computer Vision:   $COMPUTER_VISION_NAME"
    echo "  Azure Maps:        maps-acfixbot-${ENVIRONMENT}"
    echo "  Function App:      $FUNCTION_APP_NAME"
    echo ""

    # Mostrar advertencias si faltan configuraciones
    if [ -z "$WHATSAPP_TOKEN" ]; then
        log_warning "WHATSAPP_TOKEN no configurado - podras agregarlo despues"
    fi
    if [ -z "$GEMINI_API_KEY" ]; then
        log_warning "GEMINI_API_KEY no configurado - IA deshabilitada"
    fi
    if [ -z "$AZURE_MAPS_KEY" ]; then
        log_warning "AZURE_MAPS_KEY no configurado - se creara automaticamente"
    fi

    echo ""
    # Auto-confirm si se pasa --yes o -y como argumento
    if [[ "$AUTO_CONFIRM" == "true" ]]; then
        log_info "Auto-confirmado (--yes flag)"
    else
        read -p "Continuar con el deployment? (y/N): " CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            log_info "Deployment cancelado"
            exit 0
        fi
    fi
}

# ----------------------------------------------------------------------------
# EJECUTAR PASOS
# ----------------------------------------------------------------------------

run_step() {
    local SCRIPT_NAME=$1
    local DESCRIPTION=$2
    shift 2
    local ARGS="$@"

    log_step "$DESCRIPTION"

    if [ -f "${SCRIPT_DIR}/${SCRIPT_NAME}" ]; then
        chmod +x "${SCRIPT_DIR}/${SCRIPT_NAME}"
        "${SCRIPT_DIR}/${SCRIPT_NAME}" $ARGS
    else
        log_error "Script no encontrado: ${SCRIPT_NAME}"
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------

main() {
    # Procesar argumentos
    AUTO_CONFIRM="false"
    for arg in "$@"; do
        case $arg in
            --yes|-y)
                AUTO_CONFIRM="true"
                ;;
        esac
    done

    echo ""
    echo "============================================================================"
    echo "    _    ____   _____ _      ____        _   "
    echo "   / \  / ___| |  ___(_)_  _| __ )  ___ | |_ "
    echo "  / _ \| |     | |_  | \ \/ /  _ \ / _ \| __|"
    echo " / ___ \ |___  |  _| | |>  <| |_) | (_) | |_ "
    echo "/_/   \_\____| |_|   |_/_/\_\____/ \___/ \__|"
    echo ""
    echo "              Deploy Completo a Azure"
    echo "============================================================================"

    # Verificaciones iniciales
    check_config
    show_summary

    # Medir tiempo
    START_TIME=$(date +%s)

    # Paso 1: Infraestructura
    run_step "deploy-infrastructure.sh" "PASO 1/4: Creando Infraestructura Azure"

    # Paso 2: Base de datos
    run_step "init-database.sh" "PASO 2/4: Inicializando Base de Datos" --yes

    # Paso 3: Deploy codigo
    run_step "deploy-function.sh" "PASO 3/4: Desplegando Function App"

    # Paso 4: Sincronizar local.settings.json
    run_step "sync-local-settings.sh" "PASO 4/4: Sincronizando local.settings.json"

    # Calcular tiempo total
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))

    # Cargar outputs
    if [ -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        source "${SCRIPT_DIR}/deployment-output.env"
    fi

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}DEPLOYMENT COMPLETADO EXITOSAMENTE${NC}"
    echo "============================================================================"
    echo ""
    echo "  Tiempo total: ${MINUTES}m ${SECONDS}s"
    echo ""
    echo "  Recursos creados en Azure:"
    echo "  -------------------------"
    echo "  Resource Group:    $RESOURCE_GROUP"
    echo "  SQL Server:        ${SQL_SERVER_NAME}.database.windows.net"
    echo "  SQL Database:      $SQL_DATABASE_NAME"
    echo "  Storage Account:   $STORAGE_ACCOUNT_NAME"
    echo "  Computer Vision:   $COMPUTER_VISION_NAME"
    echo "  Azure Maps:        maps-acfixbot-${ENVIRONMENT}"
    echo "  Function App:      $FUNCTION_APP_NAME"
    echo ""
    echo "  URLs:"
    echo "  -----"
    echo "  Function App:  https://${FUNCTION_APP_NAME}.azurewebsites.net"
    echo "  Webhook URL:   https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo ""
    echo "============================================================================"
    echo "  CONFIGURAR WHATSAPP BUSINESS API"
    echo "============================================================================"
    echo ""
    echo "  1. Ve a: https://developers.facebook.com"
    echo "  2. Selecciona tu App > WhatsApp > Configuration"
    echo "  3. En 'Webhook', configura:"
    echo "     - Callback URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo "     - Verify Token: (el valor de WHATSAPP_VERIFY_TOKEN en config.env)"
    echo "  4. Subscribirse a: messages"
    echo ""
    echo "============================================================================"
    echo "  COMANDOS UTILES"
    echo "============================================================================"
    echo ""
    echo "  Ver logs en tiempo real:"
    echo "    az functionapp log tail --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    echo ""
    echo "  Ver metricas:"
    echo "    az monitor metrics list --resource /subscriptions/\$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNCTION_APP_NAME --metric Requests"
    echo ""
    echo "  Reiniciar Function App:"
    echo "    az functionapp restart --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    echo ""
    echo "  Re-deploy codigo:"
    echo "    ${SCRIPT_DIR}/deploy-function.sh"
    echo ""
    echo "============================================================================"
    echo ""
}

main "$@"
