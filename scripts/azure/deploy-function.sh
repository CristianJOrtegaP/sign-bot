#!/bin/bash
# ============================================================================
# AC FIXBOT - Deploy de Function App
# ============================================================================
# Este script sube el codigo de la Function App a Azure
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Obtener directorios
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ----------------------------------------------------------------------------
# VERIFICACIONES
# ----------------------------------------------------------------------------

check_prerequisites() {
    # Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI no esta instalado"
        exit 1
    fi
    log_success "Azure CLI encontrado"

    # Verificar login
    if ! az account show &> /dev/null; then
        log_warning "No hay sesion activa en Azure. Iniciando login..."
        az login
    fi

    # Azure Functions Core Tools
    if ! command -v func &> /dev/null; then
        log_warning "Azure Functions Core Tools no encontrado"
        log_info "Para desarrollo local, instalar desde:"
        log_info "  npm install -g azure-functions-core-tools@4"
        log_info "Continuando con deploy via Azure CLI..."
    else
        log_success "Azure Functions Core Tools encontrado"
    fi

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js no esta instalado"
        exit 1
    fi
    NODE_VERSION=$(node --version)
    log_success "Node.js $NODE_VERSION encontrado"

    # Verificar package.json
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        log_error "package.json no encontrado en $PROJECT_ROOT"
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# CARGAR CONFIGURACION
# ----------------------------------------------------------------------------

load_config() {
    # Intentar cargar deployment-output.env primero
    if [ -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        source "${SCRIPT_DIR}/deployment-output.env"
    elif [ -f "${SCRIPT_DIR}/config.env" ]; then
        source "${SCRIPT_DIR}/config.env"
    else
        log_error "No se encontro archivo de configuracion"
        exit 1
    fi

    if [ -z "$FUNCTION_APP_NAME" ] || [ -z "$RESOURCE_GROUP" ]; then
        log_error "FUNCTION_APP_NAME o RESOURCE_GROUP no definidos"
        exit 1
    fi

    log_success "Configuracion cargada"
    log_info "Function App: $FUNCTION_APP_NAME"
    log_info "Resource Group: $RESOURCE_GROUP"
}

# ----------------------------------------------------------------------------
# PREPARAR PROYECTO
# ----------------------------------------------------------------------------

prepare_project() {
    log_info "Preparando proyecto..."

    cd "$PROJECT_ROOT"

    # Instalar dependencias
    log_info "Instalando dependencias de produccion..."
    npm ci --production 2>/dev/null || npm install --production

    log_success "Dependencias instaladas"

    # Verificar que existen los archivos necesarios
    REQUIRED_FILES=("host.json" "package.json" "api-whatsapp-webhook/index.js" "api-whatsapp-webhook/function.json")
    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$PROJECT_ROOT/$file" ]; then
            log_error "Archivo requerido no encontrado: $file"
            exit 1
        fi
    done

    log_success "Archivos verificados"
}

# ----------------------------------------------------------------------------
# CREAR ZIP PARA DEPLOY
# ----------------------------------------------------------------------------

create_deployment_package() {
    log_info "Creando paquete de deployment..."

    DEPLOY_DIR="$SCRIPT_DIR/.deploy"
    DEPLOY_ZIP="$SCRIPT_DIR/function-app.zip"

    # Limpiar directorio temporal
    rm -rf "$DEPLOY_DIR"
    rm -f "$DEPLOY_ZIP"
    mkdir -p "$DEPLOY_DIR"

    # Copiar archivos necesarios
    cd "$PROJECT_ROOT"

    # Archivos de configuracion
    cp host.json "$DEPLOY_DIR/"
    cp package.json "$DEPLOY_DIR/"
    [ -f "package-lock.json" ] && cp package-lock.json "$DEPLOY_DIR/"

    # Directorios de funciones (Azure Functions)
    cp -r api-whatsapp-webhook "$DEPLOY_DIR/"
    cp -r api-admin-cache "$DEPLOY_DIR/"
    cp -r api-health "$DEPLOY_DIR/"
    cp -r api-ticket-resolve "$DEPLOY_DIR/"
    cp -r timer-session-cleanup "$DEPLOY_DIR/"
    cp -r timer-survey-sender "$DEPLOY_DIR/"

    # Codigo fuente
    cp -r bot "$DEPLOY_DIR/"
    cp -r core "$DEPLOY_DIR/"

    # Node modules (ya instalados con --production)
    if [ -d "node_modules" ]; then
        cp -r node_modules "$DEPLOY_DIR/"
    fi

    # Crear ZIP
    cd "$DEPLOY_DIR"
    zip -r "$DEPLOY_ZIP" . -x "*.git*" -x "*.DS_Store" -x "*__pycache__*" > /dev/null

    # Limpiar directorio temporal
    rm -rf "$DEPLOY_DIR"

    DEPLOY_SIZE=$(du -h "$DEPLOY_ZIP" | cut -f1)
    log_success "Paquete creado: $DEPLOY_ZIP ($DEPLOY_SIZE)"
}

# ----------------------------------------------------------------------------
# DEPLOY CON AZURE CLI
# ----------------------------------------------------------------------------

deploy_with_cli() {
    log_info "Desplegando con Azure CLI..."

    # Usar zip deployment
    az functionapp deployment source config-zip \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --src "$DEPLOY_ZIP" \
        --build-remote true

    log_success "Deploy completado"
}

# ----------------------------------------------------------------------------
# DEPLOY CON FUNC TOOLS
# ----------------------------------------------------------------------------

deploy_with_func_tools() {
    log_info "Desplegando con Azure Functions Core Tools..."

    cd "$PROJECT_ROOT"

    func azure functionapp publish "$FUNCTION_APP_NAME" \
        --javascript \
        --force

    log_success "Deploy completado"
}

# ----------------------------------------------------------------------------
# VERIFICAR DEPLOY
# ----------------------------------------------------------------------------

verify_deployment() {
    log_info "Verificando deployment..."

    # Obtener URL
    FUNCTION_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
    WEBHOOK_URL="${FUNCTION_URL}/api/whatsapp-webhook"

    # Verificar que responde
    log_info "Probando endpoint de verificacion..."

    # El endpoint de verificacion de WhatsApp usa GET con hub.verify_token
    VERIFY_TOKEN="${WHATSAPP_VERIFY_TOKEN:-test}"
    CHALLENGE="test_challenge_123"

    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        "${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${CHALLENGE}" \
        2>/dev/null || echo "000")

    if [ "$RESPONSE" == "200" ]; then
        log_success "Endpoint webhook responde correctamente"
    elif [ "$RESPONSE" == "403" ]; then
        log_warning "Endpoint responde pero verify_token no coincide (esto es esperado si no configuraste WHATSAPP_VERIFY_TOKEN)"
    elif [ "$RESPONSE" == "000" ]; then
        log_warning "No se pudo conectar al endpoint (puede tardar unos minutos en estar disponible)"
    else
        log_warning "Endpoint responde con codigo HTTP: $RESPONSE"
    fi

    # Listar funciones desplegadas
    log_info "Funciones desplegadas:"
    az functionapp function list \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --query "[].{name:name, isDisabled:isDisabled}" \
        --output table 2>/dev/null || log_warning "No se pudieron listar las funciones"
}

# ----------------------------------------------------------------------------
# LIMPIAR
# ----------------------------------------------------------------------------

cleanup() {
    log_info "Limpiando archivos temporales..."
    rm -f "$SCRIPT_DIR/function-app.zip"
    rm -rf "$SCRIPT_DIR/.deploy"
    log_success "Limpieza completada"
}

# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Deploy de Function App"
    echo "============================================================================"
    echo ""

    check_prerequisites
    load_config
    prepare_project
    create_deployment_package

    # Elegir metodo de deploy
    if command -v func &> /dev/null && [ "$1" != "--cli" ]; then
        deploy_with_func_tools
    else
        deploy_with_cli
    fi

    verify_deployment
    cleanup

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}DEPLOY COMPLETADO${NC}"
    echo "============================================================================"
    echo ""
    echo "Function App URL: https://${FUNCTION_APP_NAME}.azurewebsites.net"
    echo "Webhook URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo ""
    echo "Para configurar WhatsApp Business API:"
    echo "  1. Ve a: https://developers.facebook.com"
    echo "  2. Tu App > WhatsApp > Configuration"
    echo "  3. Webhook URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    echo "  4. Verify Token: (el que configuraste en WHATSAPP_VERIFY_TOKEN)"
    echo "  5. Subscribirse a: messages"
    echo ""
    echo "Ver logs en tiempo real:"
    echo "  az functionapp log tail --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    echo ""
}

main "$@"
