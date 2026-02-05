#!/bin/bash
# ============================================================================
# AC FIXBOT - Deploy FASE 3: Escalabilidad (Redis + Service Bus)
# ============================================================================
# Este script crea los recursos de Azure para escalar a multiples instancias:
# - Azure Cache for Redis (cache distribuido)
# - Azure Service Bus (Dead Letter Queue distribuida)
# ============================================================================

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funciones de logging
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cargar configuracion
CONFIG_FILE="${SCRIPT_DIR}/config.env"
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Archivo de configuracion no encontrado: $CONFIG_FILE"
    log_info "Copia config.env.example a config.env y configura los valores"
    exit 1
fi

source "$CONFIG_FILE"

# ============================================================================
# VALIDACIONES
# ============================================================================

log_info "=== FASE 3: Desplegando recursos de escalabilidad ==="

# Verificar sesion de Azure
if ! az account show &>/dev/null; then
    log_error "No hay sesion de Azure activa. Ejecuta: az login"
    exit 1
fi

SUBSCRIPTION=$(az account show --query name -o tsv)
log_info "Suscripcion: $SUBSCRIPTION"
log_info "Resource Group: $RESOURCE_GROUP"
log_info "Location: $LOCATION"

# Verificar que el resource group existe
if ! az group show --name "$RESOURCE_GROUP" &>/dev/null; then
    log_error "Resource group '$RESOURCE_GROUP' no existe"
    log_info "Ejecuta primero: ./deploy-infrastructure.sh"
    exit 1
fi

# ============================================================================
# AZURE CACHE FOR REDIS
# ============================================================================

if [ "${ENABLE_REDIS:-false}" = "true" ]; then
    log_info ""
    log_info "=== Creando Azure Cache for Redis ==="

    REDIS_NAME="${REDIS_NAME:-redis-acfixbot-${ENVIRONMENT}}"
    REDIS_SKU="${REDIS_SKU:-Basic}"
    REDIS_CAPACITY="${REDIS_CAPACITY:-0}"

    # Verificar si ya existe
    if az redis show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
        log_warn "Redis '$REDIS_NAME' ya existe, omitiendo creacion"
    else
        log_info "Creando Redis Cache: $REDIS_NAME (SKU: $REDIS_SKU, Capacity: C$REDIS_CAPACITY)"
        log_warn "Este proceso puede tardar 15-20 minutos..."

        az redis create \
            --name "$REDIS_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --sku "$REDIS_SKU" \
            --vm-size "c$REDIS_CAPACITY" \
            --minimum-tls-version "1.2"

        log_success "Redis Cache creado: $REDIS_NAME"
    fi

    # Obtener connection info
    log_info "Obteniendo informacion de conexion de Redis..."
    REDIS_HOST=$(az redis show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query hostName -o tsv)
    REDIS_PORT=$(az redis show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query sslPort -o tsv)
    REDIS_KEY=$(az redis list-keys --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query primaryKey -o tsv)

    log_success "Redis Host: $REDIS_HOST"
    log_success "Redis Port: $REDIS_PORT"

    # Guardar para actualizar Function App
    REDIS_SETTINGS="REDIS_ENABLED=true REDIS_HOST=$REDIS_HOST REDIS_PORT=$REDIS_PORT REDIS_PASSWORD=$REDIS_KEY REDIS_TLS=true"
else
    log_warn "Redis deshabilitado (ENABLE_REDIS=false)"
    REDIS_SETTINGS=""
fi

# ============================================================================
# AZURE SERVICE BUS
# ============================================================================

if [ "${ENABLE_SERVICEBUS:-false}" = "true" ]; then
    log_info ""
    log_info "=== Creando Azure Service Bus ==="

    SERVICEBUS_NAMESPACE="${SERVICEBUS_NAMESPACE:-sb-acfixbot-${ENVIRONMENT}}"
    SERVICEBUS_SKU="${SERVICEBUS_SKU:-Basic}"
    SERVICEBUS_QUEUE="${SERVICEBUS_QUEUE_NAME:-acfixbot-messages}"

    # Verificar si el namespace ya existe
    if az servicebus namespace show --name "$SERVICEBUS_NAMESPACE" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
        log_warn "Service Bus namespace '$SERVICEBUS_NAMESPACE' ya existe, omitiendo creacion"
    else
        log_info "Creando Service Bus Namespace: $SERVICEBUS_NAMESPACE (SKU: $SERVICEBUS_SKU)"

        az servicebus namespace create \
            --name "$SERVICEBUS_NAMESPACE" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --sku "$SERVICEBUS_SKU"

        log_success "Service Bus Namespace creado: $SERVICEBUS_NAMESPACE"
    fi

    # Crear cola
    if az servicebus queue show --name "$SERVICEBUS_QUEUE" --namespace-name "$SERVICEBUS_NAMESPACE" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
        log_warn "Cola '$SERVICEBUS_QUEUE' ya existe"
    else
        log_info "Creando cola: $SERVICEBUS_QUEUE"

        az servicebus queue create \
            --name "$SERVICEBUS_QUEUE" \
            --namespace-name "$SERVICEBUS_NAMESPACE" \
            --resource-group "$RESOURCE_GROUP" \
            --max-delivery-count 3 \
            --lock-duration "PT1M" \
            --default-message-time-to-live "P1D" \
            --enable-dead-lettering-on-message-expiration true

        log_success "Cola creada: $SERVICEBUS_QUEUE"
    fi

    # Obtener connection string
    log_info "Obteniendo connection string de Service Bus..."
    SERVICEBUS_CONNECTION=$(az servicebus namespace authorization-rule keys list \
        --name "RootManageSharedAccessKey" \
        --namespace-name "$SERVICEBUS_NAMESPACE" \
        --resource-group "$RESOURCE_GROUP" \
        --query primaryConnectionString -o tsv)

    log_success "Service Bus configurado"

    # Guardar para actualizar Function App
    SERVICEBUS_SETTINGS="SERVICEBUS_ENABLED=true SERVICEBUS_CONNECTION_STRING=$SERVICEBUS_CONNECTION SERVICEBUS_QUEUE_NAME=$SERVICEBUS_QUEUE"
else
    log_warn "Service Bus deshabilitado (ENABLE_SERVICEBUS=false)"
    SERVICEBUS_SETTINGS=""
fi

# ============================================================================
# ACTUALIZAR FUNCTION APP SETTINGS
# ============================================================================

FUNCTION_APP_NAME="${FUNCTION_APP_NAME:-func-acfixbot-${ENVIRONMENT}}"

if [ -n "$REDIS_SETTINGS" ] || [ -n "$SERVICEBUS_SETTINGS" ]; then
    log_info ""
    log_info "=== Actualizando configuracion de Function App ==="

    # Construir comando de settings
    SETTINGS_CMD=""

    if [ -n "$REDIS_SETTINGS" ]; then
        SETTINGS_CMD="$SETTINGS_CMD $REDIS_SETTINGS"
    fi

    if [ -n "$SERVICEBUS_SETTINGS" ]; then
        SETTINGS_CMD="$SETTINGS_CMD $SERVICEBUS_SETTINGS"
    fi

    log_info "Actualizando settings en $FUNCTION_APP_NAME..."

    # shellcheck disable=SC2086
    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings $SETTINGS_CMD \
        --output none

    log_success "Settings actualizados en Function App"
fi

# ============================================================================
# RESUMEN
# ============================================================================

log_info ""
log_info "=============================================="
log_success "FASE 3 - Despliegue completado"
log_info "=============================================="

if [ "${ENABLE_REDIS:-false}" = "true" ]; then
    echo ""
    echo -e "${GREEN}Azure Cache for Redis:${NC}"
    echo "  Host: $REDIS_HOST"
    echo "  Port: $REDIS_PORT"
    echo "  TLS: Enabled"
fi

if [ "${ENABLE_SERVICEBUS:-false}" = "true" ]; then
    echo ""
    echo -e "${GREEN}Azure Service Bus:${NC}"
    echo "  Namespace: $SERVICEBUS_NAMESPACE"
    echo "  Queue: $SERVICEBUS_QUEUE"
fi

echo ""
log_info "Las variables de entorno ya fueron configuradas en la Function App."
log_info "El sistema ahora usara cache distribuido y DLQ distribuida."
echo ""
log_warn "NOTA: Redis puede tardar unos minutos en estar completamente disponible."
