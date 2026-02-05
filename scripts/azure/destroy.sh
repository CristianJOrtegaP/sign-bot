#!/bin/bash
# ============================================================================
# AC FIXBOT - Destruir Infraestructura
# ============================================================================
# ADVERTENCIA: Elimina TODOS los recursos del ambiente especificado
#
# Uso:
#   ./destroy.sh dev           # Destruir ambiente dev
#   ./destroy.sh dev --yes     # Sin confirmacion
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

ENVIRONMENT="${1:-dev}"
AUTO_YES=false
[[ "$2" == "--yes" || "$2" == "-y" ]] && AUTO_YES=true

# Cargar ambiente
ENV_FILE="${SCRIPT_DIR}/environments/${ENVIRONMENT}.env"
if [ ! -f "$ENV_FILE" ]; then
    log_error "Ambiente '$ENVIRONMENT' no existe"
    exit 1
fi
source "$ENV_FILE"

# Verificar login
if ! az account show &>/dev/null; then
    log_error "No hay sesion Azure. Ejecuta: az login"
    exit 1
fi

# Verificar que existe
if ! az group show --name "$RESOURCE_GROUP" &>/dev/null; then
    log_warn "Resource Group '$RESOURCE_GROUP' no existe"
    exit 0
fi

echo ""
echo "============================================================================"
echo -e "  ${RED}DESTRUIR INFRAESTRUCTURA${NC}"
echo "============================================================================"
echo ""
echo "  Ambiente:       $ENVIRONMENT"
echo "  Resource Group: $RESOURCE_GROUP"
echo ""

# Listar recursos
echo "  Recursos a eliminar:"
az resource list --resource-group "$RESOURCE_GROUP" --query "[].{name:name, type:type}" -o table

echo ""

if [ "$AUTO_YES" != true ]; then
    read -p "Estas seguro? Escribe 'ELIMINAR' para confirmar: " CONFIRM
    if [ "$CONFIRM" != "ELIMINAR" ]; then
        echo "Cancelado"
        exit 0
    fi
fi

echo ""
echo "Eliminando recursos..."

# Eliminar Resource Group (elimina todo)
az group delete --name "$RESOURCE_GROUP" --yes --no-wait

log_ok "Eliminacion iniciada (puede tardar varios minutos)"

# Limpiar archivo de outputs
rm -f "${SCRIPT_DIR}/outputs-${ENVIRONMENT}.env"

echo ""
echo "Para verificar el estado:"
echo "  az group show --name $RESOURCE_GROUP"
echo ""
