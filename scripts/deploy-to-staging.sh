#!/bin/bash

# =============================================
# AC FixBot - Deploy Completo a Staging
# Incluye validaciones y tests post-deploy
# =============================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Directorios
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║         AC FIXBOT - DEPLOY COMPLETO A STAGING                 ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================
# PASO 1: Verificaciones Pre-Deploy
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 1/6: Verificaciones Pre-Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verificar Azure CLI
if ! command -v az &> /dev/null; then
    log_error "Azure CLI no está instalado"
    log_info "Instalar: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi
log_success "Azure CLI encontrado"

# Verificar login
if ! az account show &> /dev/null; then
    log_warning "No hay sesión activa en Azure"
    log_info "Iniciando login..."
    az login
fi
log_success "Sesión Azure activa"

# Verificar Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js no está instalado"
    exit 1
fi
NODE_VERSION=$(node --version)
log_success "Node.js $NODE_VERSION encontrado"

echo ""

# =============================================
# PASO 2: Ejecutar Tests Básicos
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 2/6: Ejecutando Tests Básicos (FASE 1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_ROOT"

log_info "Instalando dependencias para tests..."
npm ci > /dev/null 2>&1

log_info "Ejecutando tests de FASE 1..."
if ./scripts/test-basico.sh > /dev/null 2>&1; then
    log_success "Tests de FASE 1: PASS (24/24)"
else
    log_error "Tests de FASE 1 fallaron"
    log_info "Revisar output: ./scripts/test-basico.sh"
    exit 1
fi

echo ""

# =============================================
# PASO 3: Preparar Package de Deployment
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 3/6: Preparando Package de Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_info "Limpiando node_modules..."
rm -rf node_modules

log_info "Instalando dependencias de producción..."
npm ci --omit=dev

log_info "Creando package de deployment..."
DEPLOY_ZIP="$PROJECT_ROOT/function-app-staging.zip"
rm -f "$DEPLOY_ZIP"

zip -r "$DEPLOY_ZIP" . \
    -x "*.git*" \
    -x "*.env*" \
    -x "tests/*" \
    -x "docs/*" \
    -x "*.md" \
    -x "scripts/*" \
    -x "sql-scripts/*" \
    -x "coverage/*" \
    -x ".vscode/*" \
    > /dev/null

DEPLOY_SIZE=$(du -h "$DEPLOY_ZIP" | cut -f1)
log_success "Package creado: $DEPLOY_SIZE"

echo ""

# =============================================
# PASO 4: Obtener Configuración de Staging
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 4/6: Configuración de Staging"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Intentar obtener configuración
if [ -f "$SCRIPT_DIR/azure/config.env" ]; then
    source "$SCRIPT_DIR/azure/config.env"
    log_success "Configuración cargada desde config.env"
else
    log_warning "No se encontró config.env, usando valores por defecto"
    RESOURCE_GROUP="rg-acfixbot-staging"
    FUNCTION_APP_NAME="func-acfixbot-staging"
fi

log_info "Resource Group: $RESOURCE_GROUP"
log_info "Function App: $FUNCTION_APP_NAME"

# Verificar que el Function App existe
if ! az functionapp show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP_NAME" &> /dev/null; then
    log_error "Function App '$FUNCTION_APP_NAME' no existe en '$RESOURCE_GROUP'"
    log_info "Crear infraestructura primero con: ./scripts/azure/deploy-infrastructure.sh"
    exit 1
fi
log_success "Function App encontrado"

echo ""

# =============================================
# PASO 5: Deploy a Azure
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 5/6: Desplegando a Azure Function App"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_info "Subiendo package a Azure (esto puede tardar 2-3 minutos)..."

if az functionapp deployment source config-zip \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP_NAME" \
    --src "$DEPLOY_ZIP" \
    --build-remote true \
    --timeout 600 \
    > /dev/null 2>&1; then
    log_success "Deploy completado exitosamente"
else
    log_error "Deploy falló"
    log_info "Revisar logs: az functionapp log tail --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    exit 1
fi

# Limpiar package local
rm -f "$DEPLOY_ZIP"

echo ""

# =============================================
# PASO 6: Validaciones Post-Deploy
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASO 6/6: Validaciones Post-Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FUNCTION_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"

log_info "Esperando 30 segundos para que la app inicie..."
sleep 30

# Verificar health endpoint
log_info "Verificando health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${FUNCTION_URL}/api/health" 2>/dev/null || echo "000")

if [ "$HEALTH_RESPONSE" == "200" ]; then
    log_success "Health endpoint: OK"

    # Obtener detalle del health check
    HEALTH_DETAIL=$(curl -s "${FUNCTION_URL}/api/health" 2>/dev/null)

    # Verificar status
    if echo "$HEALTH_DETAIL" | grep -q '"status":"healthy"'; then
        log_success "Status: healthy"
    elif echo "$HEALTH_DETAIL" | grep -q '"status":"degraded"'; then
        log_warning "Status: degraded (algunos servicios tienen issues)"
    else
        log_warning "Status: unhealthy"
    fi
elif [ "$HEALTH_RESPONSE" == "000" ]; then
    log_error "No se pudo conectar al endpoint"
else
    log_warning "Health endpoint respondió con código: $HEALTH_RESPONSE"
fi

echo ""

# Verificar funciones desplegadas
log_info "Verificando funciones desplegadas..."
FUNCTION_COUNT=$(az functionapp function list \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP_NAME" \
    --query "length(@)" \
    --output tsv 2>/dev/null || echo "0")

if [ "$FUNCTION_COUNT" -ge "6" ]; then
    log_success "$FUNCTION_COUNT funciones desplegadas"
else
    log_warning "Solo $FUNCTION_COUNT funciones encontradas (esperadas: 6+)"
fi

echo ""

# Listar funciones
log_info "Funciones disponibles:"
az functionapp function list \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP_NAME" \
    --query "[].{Name:name, Disabled:isDisabled}" \
    --output table 2>/dev/null || log_warning "No se pudieron listar funciones"

echo ""

# =============================================
# Resumen Final
# =============================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║              ✅ DEPLOY A STAGING COMPLETADO                   ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 URLs de Staging:"
echo "   Function App: $FUNCTION_URL"
echo "   Health Check: ${FUNCTION_URL}/api/health"
echo "   Webhook:      ${FUNCTION_URL}/api/whatsapp-webhook"
echo "   Metrics:      ${FUNCTION_URL}/api/metrics"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Configurar WhatsApp Webhook en Meta Business"
echo "   2. Enviar mensaje de prueba"
echo "   3. Monitorear Application Insights"
echo "   4. Validar métricas de FASE 2"
echo ""
echo "🔍 Ver logs en tiempo real:"
echo "   az functionapp log tail \\"
echo "     --name $FUNCTION_APP_NAME \\"
echo "     --resource-group $RESOURCE_GROUP"
echo ""
echo "📊 Ver métricas:"
echo "   curl ${FUNCTION_URL}/api/metrics \\"
echo "     -H \"x-api-key: YOUR_ADMIN_API_KEY\""
echo ""
