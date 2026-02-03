#!/bin/bash
# ============================================================================
# AC FIXBOT - Destruir Infraestructura
# ============================================================================
# ADVERTENCIA: Este script ELIMINA TODOS los recursos de Azure
# Usar solo para limpieza de ambiente de desarrollo/POC
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
    elif [ -f "${SCRIPT_DIR}/config.env" ]; then
        source "${SCRIPT_DIR}/config.env"
    else
        log_error "No se encontro archivo de configuracion"
        exit 1
    fi

    if [ -z "$RESOURCE_GROUP" ]; then
        log_error "RESOURCE_GROUP no definido"
        exit 1
    fi
}

# Verificar que el resource group existe
check_resource_group() {
    if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
        log_warning "Resource Group '$RESOURCE_GROUP' no existe"
        exit 0
    fi
}

# Listar recursos
list_resources() {
    log_info "Recursos en el Resource Group '$RESOURCE_GROUP':"
    echo ""

    az resource list \
        --resource-group "$RESOURCE_GROUP" \
        --query "[].{name:name, type:type, location:location}" \
        --output table
}

# Confirmar eliminacion
confirm_deletion() {
    echo ""
    echo "============================================================================"
    echo -e "  ${RED}ADVERTENCIA: ESTO ELIMINARA TODOS LOS RECURSOS${NC}"
    echo "============================================================================"
    echo ""
    echo "  Se eliminara el Resource Group: $RESOURCE_GROUP"
    echo "  Esto incluye:"
    echo "    - SQL Server y Database (TODOS LOS DATOS)"
    echo "    - Storage Account (TODAS LAS IMAGENES)"
    echo "    - Function App"
    echo "    - Computer Vision"
    echo ""
    echo -e "  ${RED}ESTA ACCION NO SE PUEDE DESHACER${NC}"
    echo ""

    read -p "Escribe 'ELIMINAR' para confirmar: " CONFIRM

    if [ "$CONFIRM" != "ELIMINAR" ]; then
        log_info "Operacion cancelada"
        exit 0
    fi
}

# Eliminar Resource Group
delete_resource_group() {
    log_info "Eliminando Resource Group '$RESOURCE_GROUP'..."
    log_warning "Esto puede tardar varios minutos..."

    az group delete \
        --name "$RESOURCE_GROUP" \
        --yes \
        --no-wait

    log_success "Eliminacion iniciada (ejecutandose en background)"
    log_info "Puedes verificar el estado con:"
    log_info "  az group show --name $RESOURCE_GROUP"
}

# Limpiar archivos locales
cleanup_local() {
    log_info "Limpiando archivos locales..."

    rm -f "${SCRIPT_DIR}/deployment-output.env"
    rm -f "${SCRIPT_DIR}/function-app.zip"
    rm -rf "${SCRIPT_DIR}/.deploy"

    log_success "Archivos locales eliminados"
}

# Main
main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Destruir Infraestructura Azure"
    echo "============================================================================"
    echo ""

    # Verificar Azure CLI
    if ! az account show &> /dev/null; then
        log_error "No hay sesion activa en Azure"
        exit 1
    fi

    load_config
    check_resource_group
    list_resources
    confirm_deletion
    delete_resource_group

    read -p "Eliminar archivos de configuracion locales? (y/N): " CLEANUP
    if [[ "$CLEANUP" =~ ^[Yy]$ ]]; then
        cleanup_local
    fi

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}PROCESO DE ELIMINACION INICIADO${NC}"
    echo "============================================================================"
    echo ""
    echo "  El Resource Group se esta eliminando en background."
    echo "  Esto puede tardar 5-10 minutos."
    echo ""
    echo "  Para verificar cuando termine:"
    echo "    az group show --name $RESOURCE_GROUP"
    echo ""
    echo "  Cuando ya no exista, veras un error 'ResourceGroupNotFound'"
    echo ""
}

main "$@"
