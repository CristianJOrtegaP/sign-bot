#!/bin/bash
# ============================================================================
# Sign Bot - Instalador Completo Azure
# ============================================================================
# Script unico para desplegar toda la infraestructura, configurar secretos,
# inicializar la base de datos y desplegar el codigo.
#
# Uso:
#   ./deploy.sh [ambiente]              # Deploy completo
#   ./deploy.sh dev --infra-only        # Solo infraestructura (Bicep)
#   ./deploy.sh dev --code-only         # Solo codigo (functions + frontend)
#   ./deploy.sh dev --functions-only    # Solo Azure Functions (backend)
#   ./deploy.sh dev --frontend-only     # Solo Static Web App (frontend)
#   ./deploy.sh dev --db-only           # Solo base de datos
#   ./deploy.sh dev --secrets-only      # Solo Key Vault secrets
#   ./deploy.sh dev --validate          # Validar Bicep sin desplegar
#   ./deploy.sh dev --what-if           # Preview de cambios (Bicep what-if)
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

# Timer por etapa
DEPLOY_START_TIME=""
STEP_START_TIME=""
STEP_TIMES=()

format_duration() {
    local secs=$1
    if [ "$secs" -ge 60 ]; then
        printf "%dm %02ds" $((secs / 60)) $((secs % 60))
    else
        printf "%ds" "$secs"
    fi
}

log_step() {
    # Cerrar etapa anterior si existe
    if [ -n "$STEP_START_TIME" ] && [ -n "$CURRENT_STEP" ]; then
        local elapsed=$(( $(date +%s) - STEP_START_TIME ))
        STEP_TIMES+=("$(format_duration $elapsed)|$CURRENT_STEP")
        echo -e "${GREEN}[OK]${NC} $CURRENT_STEP completado en $(format_duration $elapsed)"
    fi
    # Iniciar nueva etapa
    CURRENT_STEP="$1"
    STEP_START_TIME=$(date +%s)
    echo -e "\n${CYAN}=== [$((${#STEP_TIMES[@]} + 1))] $1 ===${NC}\n"
}

show_timing_summary() {
    # Cerrar ultima etapa
    if [ -n "$STEP_START_TIME" ] && [ -n "$CURRENT_STEP" ]; then
        local elapsed=$(( $(date +%s) - STEP_START_TIME ))
        STEP_TIMES+=("$(format_duration $elapsed)|$CURRENT_STEP")
        echo -e "${GREEN}[OK]${NC} $CURRENT_STEP completado en $(format_duration $elapsed)"
    fi

    local total_elapsed=$(( $(date +%s) - DEPLOY_START_TIME ))
    echo ""
    echo -e "${CYAN}--- Tiempos por etapa ---${NC}"
    local i=1
    for entry in "${STEP_TIMES[@]}"; do
        local duration="${entry%%|*}"
        local name="${entry#*|}"
        printf "  ${CYAN}%d.${NC} %-35s %s\n" "$i" "$name" "$duration"
        i=$((i + 1))
    done
    echo -e "  ${CYAN}─────────────────────────────────────────────${NC}"
    echo -e "  ${GREEN}Total:${NC}                                  $(format_duration $total_elapsed)"
    echo ""
    STEP_START_TIME=""
    CURRENT_STEP=""
}

# ============================================================================
# CONFIGURACION
# ============================================================================

ENVIRONMENT="${1:-dev}"
INFRA_ONLY=false
CODE_ONLY=false
FUNCTIONS_ONLY=false
FRONTEND_ONLY=false
DB_ONLY=false
SECRETS_ONLY=false
VALIDATE_ONLY=false
WHAT_IF=false
AUTO_YES=false

# Parsear flags
for arg in "$@"; do
    case $arg in
        --infra-only) INFRA_ONLY=true ;;
        --code-only) CODE_ONLY=true ;;
        --functions-only) FUNCTIONS_ONLY=true ;;
        --frontend-only) FRONTEND_ONLY=true ;;
        --db-only) DB_ONLY=true ;;
        --secrets-only) SECRETS_ONLY=true ;;
        --validate) VALIDATE_ONLY=true ;;
        --what-if) WHAT_IF=true ;;
        -y|--yes) AUTO_YES=true ;;
    esac
done

# Nombres de recursos derivados del naming convention (mismos que naming.bicep)
derive_resource_names() {
    # NOTA: dev usa 'development' para evitar conflictos con recursos soft-deleted
    local ENV_SUFFIX="${ENVIRONMENT}"
    [ "$ENVIRONMENT" = "dev" ] && ENV_SUFFIX="development"

    RESOURCE_GROUP="rg-signbot-${ENV_SUFFIX}"
    FUNCTION_APP_NAME="func-signbot-${ENV_SUFFIX}"
    KEY_VAULT_NAME="kv-signbot-${ENV_SUFFIX}"
    SQL_SERVER_NAME="sql-signbot-${ENV_SUFFIX}"
    SQL_DATABASE_NAME="db-signbot"
    STORAGE_ACCOUNT_NAME="stsignbot${ENV_SUFFIX}"
    COMPUTER_VISION_NAME="cv-signbot-${ENV_SUFFIX}"
    SPEECH_NAME="speech-signbot-${ENV_SUFFIX}"
    MAPS_NAME="maps-signbot-${ENV_SUFFIX}"
    OPENAI_NAME="oai-signbot-${ENV_SUFFIX}"
    WHISPER_OPENAI_NAME="oai-signbot-whisper-${ENV_SUFFIX}"
    REDIS_NAME="redis-signbot-${ENV_SUFFIX}"
    SERVICE_BUS_NAME="sb-signbot-${ENV_SUFFIX}"
    APP_INSIGHTS_NAME="appi-signbot-${ENV_SUFFIX}"
    SWA_NAME="swa-signbot-${ENV_SUFFIX}"
    APP_SERVICE_PLAN_NAME="asp-signbot-${ENV_SUFFIX}"
    LOG_ANALYTICS_NAME="log-signbot-${ENV_SUFFIX}"
}

load_environment() {
    # Cargar archivo de ambiente (para secretos y config extra)
    ENV_FILE="${SCRIPT_DIR}/environments/${ENVIRONMENT}.env"

    if [ ! -f "$ENV_FILE" ]; then
        log_error "Ambiente '$ENVIRONMENT' no existe"
        log_info "Ambientes disponibles: dev, tst, prod"
        exit 1
    fi

    source "$ENV_FILE"

    # Cargar secretos del ambiente (config.dev.env, config.tst.env, config.prod.env)
    local CONFIG_FILE="${SCRIPT_DIR}/config.${ENVIRONMENT}.env"
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
    elif [ -f "${SCRIPT_DIR}/config.env" ]; then
        # Fallback: config.env generico (legacy)
        source "${SCRIPT_DIR}/config.env"
    fi

    # Derivar nombres de recurso (sobreescribe los del .env)
    derive_resource_names

    log_ok "Ambiente cargado: $ENVIRONMENT"
}

prompt_secrets() {
    # Solicitar secretos faltantes interactivamente
    # Si --yes o no hay TTY, solo valida lo requerido sin preguntar

    if [ -z "$SQL_ADMIN_PASSWORD" ]; then
        if [ "$AUTO_YES" = true ] || [ ! -t 0 ]; then
            log_error "SQL_ADMIN_PASSWORD es requerido. Configuralo en config.env"
            exit 1
        fi
        echo ""
        log_warn "SQL_ADMIN_PASSWORD no configurado"
        log_info "Requisitos: min 12 chars, mayusculas, minusculas, numeros, simbolos"
        read -s -p "  Ingresa password SQL: " SQL_ADMIN_PASSWORD
        echo ""
        if [ -z "$SQL_ADMIN_PASSWORD" ]; then
            log_error "Password SQL es requerido"
            exit 1
        fi
    fi

    # WhatsApp tokens son opcionales - solo preguntar en modo interactivo
    if [ -z "$WHATSAPP_TOKEN" ] && [ "$AUTO_YES" != true ] && [ -t 0 ]; then
        echo ""
        log_warn "WHATSAPP_TOKEN no configurado (opcional, se puede agregar despues)"
        log_info "Obtener de: https://developers.facebook.com > Tu App > WhatsApp"
        read -s -p "  Ingresa WhatsApp Token (Enter para omitir): " WHATSAPP_TOKEN
        echo ""
    fi

    if [ -z "$WHATSAPP_VERIFY_TOKEN" ] && [ -n "$WHATSAPP_TOKEN" ]; then
        if [ "$AUTO_YES" != true ] && [ -t 0 ]; then
            log_warn "WHATSAPP_VERIFY_TOKEN no configurado"
            read -p "  Ingresa Verify Token (Enter para generar uno): " WHATSAPP_VERIFY_TOKEN
        fi
        if [ -z "$WHATSAPP_VERIFY_TOKEN" ]; then
            WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16)
            log_info "Verify Token generado: $WHATSAPP_VERIFY_TOKEN"
        fi
    fi
}

check_prerequisites() {
    log_step "Verificando prerequisitos"

    local has_error=false

    # Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI no instalado"
        log_info "Instalar: https://docs.microsoft.com/cli/azure/install-azure-cli"
        has_error=true
    else
        log_ok "Azure CLI $(az version --query '\"azure-cli\"' -o tsv 2>/dev/null)"
    fi

    # Bicep
    if ! az bicep version &>/dev/null 2>&1; then
        log_info "Instalando Bicep CLI..."
        az bicep install
    fi
    log_ok "Bicep $(az bicep version 2>&1 | grep -o 'v[0-9.]*')"

    # Login
    if ! az account show &> /dev/null; then
        log_warn "No hay sesion Azure, iniciando login..."
        az login
    fi

    ACCOUNT=$(az account show --query name -o tsv)
    SUBSCRIPTION_ID=$(az account show --query id -o tsv)
    log_ok "Conectado: $ACCOUNT ($SUBSCRIPTION_ID)"

    # Registrar resource providers requeridos (sin esperar, se registran en background)
    local REQUIRED_PROVIDERS=(
        "Microsoft.Web"
        "Microsoft.Storage"
        "Microsoft.Sql"
        "Microsoft.KeyVault"
        "Microsoft.CognitiveServices"
        "Microsoft.Maps"
        "Microsoft.OperationalInsights"
        "Microsoft.Insights"
        "Microsoft.AlertsManagement"
    )
    log_info "Verificando resource providers..."
    for provider in "${REQUIRED_PROVIDERS[@]}"; do
        local state=$(az provider show --namespace "$provider" --query "registrationState" -o tsv 2>/dev/null)
        if [ "$state" != "Registered" ]; then
            az provider register --namespace "$provider" --wait false 2>/dev/null
            log_info "  Registrando $provider..."
        fi
    done
    log_ok "Resource providers verificados"

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js no instalado"
        has_error=true
    else
        log_ok "Node.js $(node --version)"
    fi

    # sqlcmd (para init_database)
    SQLCMD=""
    for path in "sqlcmd" "/opt/mssql-tools18/bin/sqlcmd" "/opt/mssql-tools/bin/sqlcmd" "/opt/homebrew/bin/sqlcmd"; do
        if command -v "$path" &>/dev/null || [ -f "$path" ]; then
            SQLCMD="$path"
            break
        fi
    done
    if [ -n "$SQLCMD" ]; then
        log_ok "sqlcmd: $SQLCMD"
    else
        log_warn "sqlcmd no encontrado (necesario para --db-only)"
        log_info "Instalar: brew install microsoft/mssql-release/mssql-tools18 (macOS)"
    fi

    # func (para code deploy alternativo)
    if command -v func &>/dev/null; then
        log_ok "Azure Functions Core Tools $(func --version 2>/dev/null)"
    fi

    if [ "$has_error" = true ]; then
        log_error "Prerequisitos faltantes. Corrige los errores arriba."
        exit 1
    fi
}

# ============================================================================
# LIMPIEZA PRE-DEPLOY (soft-deleted resources)
# ============================================================================

preflight_cleanup() {
    log_step "Verificando recursos soft-deleted"

    # --- Key Vault ---
    local KV_DELETED=$(az keyvault list-deleted --query "[?name=='${KEY_VAULT_NAME}'].name" -o tsv 2>/dev/null)
    if [ -n "$KV_DELETED" ]; then
        log_warn "Key Vault '$KEY_VAULT_NAME' esta soft-deleted"
        # Intentar purgar primero (solo funciona sin purge protection)
        if az keyvault purge --name "$KEY_VAULT_NAME" 2>/dev/null; then
            log_ok "Key Vault purgado"
        else
            # Si no se puede purgar, recuperar para que Bicep lo actualice
            log_info "No se puede purgar (purge protection). Recuperando..."
            az keyvault recover --name "$KEY_VAULT_NAME" --output none 2>/dev/null || true
            log_ok "Key Vault recuperado (Bicep lo actualizara)"
        fi
    fi

    # --- Cognitive Services ---
    # Detectar ubicacion real de cada recurso soft-deleted (OpenAI/Whisper usan regiones distintas)
    local CS_DELETED_LIST
    CS_DELETED_LIST=$(az cognitiveservices account list-deleted --query "[].{name:name, location:location}" -o tsv 2>/dev/null)
    local CS_NAMES=("$COMPUTER_VISION_NAME" "$SPEECH_NAME" "$OPENAI_NAME" "$WHISPER_OPENAI_NAME")
    local PURGE_OCCURRED=false
    for cs_name in "${CS_NAMES[@]}"; do
        local cs_location
        cs_location=$(echo "$CS_DELETED_LIST" | awk -v name="$cs_name" '$1 == name {print $2}')
        if [ -n "$cs_location" ]; then
            log_warn "Cognitive Service '$cs_name' esta soft-deleted ($cs_location), purgando..."
            az cognitiveservices account purge --name "$cs_name" --resource-group "$RESOURCE_GROUP" --location "$cs_location" 2>/dev/null || true
            PURGE_OCCURRED=true
            log_ok "$cs_name purgado"
        fi
    done

    # Esperar a que Azure finalice las purgas antes de iniciar Bicep
    # Las purgas de Cognitive Services pueden tardar 1-3 minutos
    if [ "$PURGE_OCCURRED" = true ]; then
        log_info "Esperando finalizacion de purgas (polling hasta 5 min)..."
        local purge_done=false
        for attempt in $(seq 1 30); do
            local STILL_DELETED
            STILL_DELETED=$(az cognitiveservices account list-deleted \
                --query "[?name=='${OPENAI_NAME}' || name=='${WHISPER_OPENAI_NAME}' || name=='${COMPUTER_VISION_NAME}' || name=='${SPEECH_NAME}'].name" \
                -o tsv 2>/dev/null || echo "")
            if [ -z "$STILL_DELETED" ]; then
                purge_done=true
                break
            fi
            log_info "  Aun purgando: $(echo $STILL_DELETED | tr '\n' ', ')... (intento $attempt/30)"
            sleep 10
        done
        if [ "$purge_done" = true ]; then
            log_ok "Todas las purgas completadas"
        else
            log_warn "Timeout esperando purgas — Bicep puede fallar con RequestConflict"
        fi
    fi

    log_ok "Preflight cleanup completado"
}

# ============================================================================
# INFRAESTRUCTURA CON BICEP
# ============================================================================

deploy_bicep() {
    BICEP_FILE="$PROJECT_ROOT/infra/main.bicep"

    if [ ! -f "$BICEP_FILE" ]; then
        log_error "Bicep template no encontrado: $BICEP_FILE"
        exit 1
    fi

    # Usar ENV_SUFFIX para consistencia (dev→development)
    local ENV_SUFFIX="${ENVIRONMENT}"
    [ "$ENVIRONMENT" = "dev" ] && ENV_SUFFIX="development"
    DEPLOYMENT_NAME="signbot-${ENV_SUFFIX}-$(date +%Y%m%d%H%M%S)"
    LOCATION="${LOCATION:-eastus}"

    # Flags de recursos opcionales (leidos del env, default false)
    local DEPLOY_OPENAI="false"
    [ "${ENABLE_AZURE_OPENAI}" = "true" ] && DEPLOY_OPENAI="true"

    local DEPLOY_WHISPER="false"
    [ "${ENABLE_WHISPER_MODEL}" = "true" ] && DEPLOY_WHISPER="true"

    local DEPLOY_REDIS="false"
    [ "${ENABLE_REDIS}" = "true" ] && DEPLOY_REDIS="true"

    local DEPLOY_SERVICEBUS="false"
    [ "${ENABLE_SERVICEBUS}" = "true" ] && DEPLOY_SERVICEBUS="true"

    # Parametros comunes
    BICEP_PARAMS=(
        --parameters environment="$ENVIRONMENT"
        --parameters location="$LOCATION"
        --parameters projectName="signbot"
        --parameters sqlAdminLogin="${SQL_ADMIN_USER:-sqladmin}"
        --parameters sqlAdminPassword="$SQL_ADMIN_PASSWORD"
        --parameters deployOpenAI="$DEPLOY_OPENAI"
        --parameters openAILocation="${AZURE_OPENAI_LOCATION:-eastus}"
        --parameters deployWhisper="$DEPLOY_WHISPER"
        --parameters whisperLocation="${AZURE_WHISPER_LOCATION:-northcentralus}"
        --parameters deployRedis="$DEPLOY_REDIS"
        --parameters deployServiceBus="$DEPLOY_SERVICEBUS"
    )

    # --- Modo: Validate ---
    if [ "$VALIDATE_ONLY" = true ]; then
        log_step "Validando Bicep template"

        log_info "Compilando Bicep..."
        az bicep build --file "$BICEP_FILE" --stdout > /dev/null
        log_ok "Bicep compila correctamente"

        log_info "Validando deployment..."
        az deployment sub validate \
            --name "$DEPLOYMENT_NAME" \
            --location "$LOCATION" \
            --template-file "$BICEP_FILE" \
            "${BICEP_PARAMS[@]}" \
            --output none
        log_ok "Validacion exitosa - template listo para deploy"
        return 0
    fi

    # --- Modo: What-If ---
    if [ "$WHAT_IF" = true ]; then
        log_step "Preview de cambios (What-If)"

        az deployment sub what-if \
            --name "$DEPLOYMENT_NAME" \
            --location "$LOCATION" \
            --template-file "$BICEP_FILE" \
            "${BICEP_PARAMS[@]}"
        return 0
    fi

    # --- Modo: Deploy ---
    log_step "Desplegando infraestructura con Bicep"

    log_info "Deployment: $DEPLOYMENT_NAME"
    log_info "Ambiente: $ENVIRONMENT"
    log_info "Location: $LOCATION"
    echo ""

    # Confirmacion para prod
    if [ "$ENVIRONMENT" = "prod" ] && [ "$AUTO_YES" != true ]; then
        echo -e "${RED}ATENCION: Estas a punto de desplegar en PRODUCCION${NC}"
        read -p "  Continuar? (escribe 'si' para confirmar): " confirm
        if [ "$confirm" != "si" ]; then
            log_info "Deploy cancelado"
            exit 0
        fi
    fi

    log_info "Desplegando (esto puede tardar 5-15 minutos)..."
    echo ""

    # Ejecutar deployment en background para poder hacer polling en vivo
    az deployment sub create \
        --name "$DEPLOYMENT_NAME" \
        --location "$LOCATION" \
        --template-file "$BICEP_FILE" \
        "${BICEP_PARAMS[@]}" \
        --output none &
    local DEPLOY_PID=$!

    # Polling en vivo de operaciones
    monitor_deployment "$DEPLOYMENT_NAME" "$DEPLOY_PID"

    # Esperar a que termine el proceso de az
    wait "$DEPLOY_PID"
    local DEPLOY_EXIT=$?

    if [ "$DEPLOY_EXIT" -ne 0 ]; then
        echo ""
        log_error "Deployment fallo (exit code $DEPLOY_EXIT)"
        # Mostrar errores del deployment
        az deployment sub show --name "$DEPLOYMENT_NAME" \
            --query "properties.error" -o json 2>/dev/null || true
        exit 1
    fi

    echo ""
    log_ok "Infraestructura desplegada exitosamente"

    # Resumen final de tiempos por recurso (captura todo incluyendo lo que el polling pudo perder)
    show_resource_summary "$DEPLOYMENT_NAME"

    # Guardar outputs del deployment
    save_deployment_outputs "$DEPLOYMENT_NAME"
}

monitor_deployment() {
    local DEPLOYMENT_NAME="$1"
    local DEPLOY_PID="$2"
    local SEEN_FILE
    SEEN_FILE=$(mktemp)
    echo "" > "$SEEN_FILE"

    # Esperar un poco para que Azure registre el deployment
    sleep 5

    while kill -0 "$DEPLOY_PID" 2>/dev/null; do
        # Obtener operaciones actuales
        local OPS
        OPS=$(az deployment operation sub list \
            --name "$DEPLOYMENT_NAME" \
            --query "[?properties.targetResource.resourceName != null].{name:properties.targetResource.resourceName, status:properties.provisioningState, duration:properties.duration}" \
            -o json 2>/dev/null || echo "[]")

        if [ "$OPS" != "[]" ]; then
            # Procesar y mostrar cambios de estado
            echo "$OPS" | python3 -c "
import json, sys, re

ops = json.load(sys.stdin)

# Leer estado previo
seen = set()
try:
    with open('$SEEN_FILE') as f:
        seen = set(line.strip() for line in f if line.strip())
except: pass

new_lines = []
CYAN, GREEN, RED, NC = '\033[0;36m', '\033[0;32m', '\033[0;31m', '\033[0m'

for op in ops:
    name = op.get('name', '')
    status = op.get('status', '')
    dur = op.get('duration', '') or ''
    if not name: continue

    key_run = f'RUN:{name}'
    key_done = f'DONE:{name}'

    if status in ('Running', 'Accepted') and key_run not in seen:
        print(f'  {CYAN}\u25b6 Iniciando:{NC}  {name}')
        new_lines.append(key_run)

    elif status == 'Succeeded' and key_done not in seen:
        dur_str = ''
        m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?', dur)
        if m:
            h, mins, secs = int(m.group(1) or 0), int(m.group(2) or 0), int(float(m.group(3) or 0))
            if h > 0: dur_str = f'{h}h {mins:02d}m {secs:02d}s'
            elif mins > 0: dur_str = f'{mins}m {secs:02d}s'
            else: dur_str = f'{secs}s'
        print(f'  {GREEN}\u2713 Listo:{NC}     {name:<28} {CYAN}{dur_str}{NC}')
        new_lines.append(key_done)

    elif status == 'Failed' and key_done not in seen:
        print(f'  {RED}\u2717 Fallo:{NC}     {name}')
        new_lines.append(key_done)

# Guardar estado actualizado
if new_lines:
    with open('$SEEN_FILE', 'a') as f:
        for line in new_lines:
            f.write(line + '\n')
" 2>/dev/null
        fi

        sleep 8
    done

    rm -f "$SEEN_FILE"
}

show_resource_summary() {
    local DEPLOYMENT_NAME="$1"

    local OPS
    OPS=$(az deployment operation sub list \
        --name "$DEPLOYMENT_NAME" \
        --query "sort_by([?properties.targetResource.resourceName != null].{name:properties.targetResource.resourceName, duration:properties.duration, status:properties.provisioningState}, &properties.duration)" \
        -o json 2>/dev/null || echo "[]")

    [ "$OPS" = "[]" ] && return 0

    echo ""
    echo -e "  ${CYAN}Resumen de recursos desplegados:${NC}"
    printf "  ${CYAN}%-30s %-12s %s${NC}\n" "Recurso" "Duracion" "Estado"
    echo "  ────────────────────────────────────────────────────────"

    echo "$OPS" | python3 -c "
import json, sys, re

ops = json.load(sys.stdin)
CYAN, GREEN, RED, NC = '\033[0;36m', '\033[0;32m', '\033[0;31m', '\033[0m'

# Ordenar por duracion (mayor primero) para ver cuellos de botella
def parse_secs(d):
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?', d or 'PT0S')
    if not m: return 0
    return int(m.group(1) or 0)*3600 + int(m.group(2) or 0)*60 + int(float(m.group(3) or 0))

ops.sort(key=lambda x: parse_secs(x.get('duration', '')), reverse=True)

for op in ops:
    name = op.get('name', '?')[:28]
    status = op.get('status', '?')
    dur = op.get('duration', 'PT0S') or 'PT0S'
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?', dur)
    if m:
        h, mins, secs = int(m.group(1) or 0), int(m.group(2) or 0), int(float(m.group(3) or 0))
        if h > 0: dur_str = f'{h}h {mins:02d}m {secs:02d}s'
        elif mins > 0: dur_str = f'{mins}m {secs:02d}s'
        else: dur_str = f'{secs}s'
    else:
        dur_str = dur
    color = GREEN if status == 'Succeeded' else RED
    print(f'  {name:<30} {dur_str:<12} {color}{status}{NC}')
" 2>/dev/null || true
    echo ""
}

save_deployment_outputs() {
    local DEPLOYMENT_NAME="$1"

    log_info "Extrayendo outputs del deployment..."

    # Una sola llamada para todos los outputs, parseados con python3 (robusto vs grep)
    local OUTPUTS
    OUTPUTS=$(az deployment sub show --name "$DEPLOYMENT_NAME" \
        --query "properties.outputs" -o json 2>/dev/null || echo "{}")
    FUNC_HOSTNAME=$(echo "$OUTPUTS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('functionAppHostname',{}).get('value',''))" 2>/dev/null || echo "")
    SQL_FQDN=$(echo "$OUTPUTS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sqlServerFqdn',{}).get('value',''))" 2>/dev/null || echo "")
    STORAGE_EP=$(echo "$OUTPUTS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('storageEndpoint',{}).get('value',''))" 2>/dev/null || echo "")
    INSIGHTS_KEY=$(echo "$OUTPUTS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('appInsightsKey',{}).get('value',''))" 2>/dev/null || echo "")
    SWA_HOSTNAME=$(echo "$OUTPUTS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('staticWebAppHostname',{}).get('value',''))" 2>/dev/null || echo "")
    KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv 2>/dev/null || echo "")

    cat > "${SCRIPT_DIR}/outputs-${ENVIRONMENT}.env" << EOF
# Auto-generated by deploy.sh: $(date)
ENVIRONMENT="$ENVIRONMENT"
RESOURCE_GROUP="$RESOURCE_GROUP"
DEPLOYMENT_NAME="$DEPLOYMENT_NAME"
FUNCTION_APP_NAME="$FUNCTION_APP_NAME"
FUNCTION_URL="https://${FUNC_HOSTNAME}"
WEBHOOK_URL="https://${FUNC_HOSTNAME}/api/whatsapp-webhook"
SQL_SERVER_FQDN="$SQL_FQDN"
SQL_DATABASE_NAME="$SQL_DATABASE_NAME"
KEY_VAULT_NAME="$KEY_VAULT_NAME"
KEY_VAULT_URI="$KEY_VAULT_URI"
APP_INSIGHTS_KEY="$INSIGHTS_KEY"
STORAGE_ENDPOINT="$STORAGE_EP"
DASHBOARD_URL="https://${SWA_HOSTNAME}"
EOF

    log_ok "Outputs guardados: outputs-${ENVIRONMENT}.env"
}

# ============================================================================
# KEY VAULT SECRETS
# ============================================================================

populate_key_vault() {
    log_step "Poblando Key Vault con secretos"

    # Verificar que Key Vault existe
    if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null 2>&1; then
        log_error "Key Vault '$KEY_VAULT_NAME' no existe. Ejecuta primero el deploy de infraestructura."
        return 1
    fi

    KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv)
    KV_ID=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

    # Asignar rol "Key Vault Secrets Officer" al usuario actual (para poder escribir secretos)
    # Nota: el Function App ya tiene "Key Vault Secrets User" via Bicep (RBAC)
    log_info "Asignando permisos de Key Vault al usuario actual..."
    USER_OID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || echo "")
    if [ -n "$USER_OID" ]; then
        az role assignment create \
            --role "Key Vault Secrets Officer" \
            --assignee-object-id "$USER_OID" \
            --scope "$KV_ID" \
            --assignee-principal-type User \
            --output none 2>/dev/null || true
        # RBAC propagation toma 1-5 minutos — esperar con backoff progresivo
        log_info "Esperando propagacion RBAC (hasta 5 min)..."
        local rbac_ready=false
        for attempt in $(seq 1 15); do
            if az keyvault secret list --vault-name "$KEY_VAULT_NAME" --maxresults 1 --output none 2>/dev/null; then
                rbac_ready=true
                break
            fi
            sleep $((attempt < 6 ? 10 : 20))
        done
        if [ "$rbac_ready" = true ]; then
            log_ok "Permisos RBAC activos"
        else
            log_warn "RBAC puede no estar propagado aun — continuando de todos modos"
        fi
    fi

    # ---- SQL Connection String ----
    log_info "Secreto: SQL-CONNECTION-STRING"
    SQL_CONN="Server=tcp:${SQL_SERVER_NAME}.database.windows.net,1433;Initial Catalog=${SQL_DATABASE_NAME};Persist Security Info=False;User ID=${SQL_ADMIN_USER:-sqladmin};Password=${SQL_ADMIN_PASSWORD};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"
    az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "SQL-CONNECTION-STRING" --value "$SQL_CONN" --output none 2>/dev/null || log_warn "No se pudo guardar SQL-CONNECTION-STRING"

    # ---- WhatsApp ----
    if [ -n "$WHATSAPP_TOKEN" ]; then
        log_info "Secreto: WHATSAPP-TOKEN"
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "WHATSAPP-TOKEN" --value "$WHATSAPP_TOKEN" --output none 2>/dev/null || true
    fi
    if [ -n "$WHATSAPP_VERIFY_TOKEN" ]; then
        log_info "Secreto: WHATSAPP-VERIFY-TOKEN"
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "WHATSAPP-VERIFY-TOKEN" --value "$WHATSAPP_VERIFY_TOKEN" --output none 2>/dev/null || true
    fi
    if [ -n "$WHATSAPP_APP_SECRET" ]; then
        log_info "Secreto: WHATSAPP-APP-SECRET"
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "WHATSAPP-APP-SECRET" --value "$WHATSAPP_APP_SECRET" --output none 2>/dev/null || true
    fi

    # ---- Computer Vision (auto-extraido) ----
    log_info "Secreto: VISION-KEY + VISION-ENDPOINT"
    CV_KEY=$(az cognitiveservices account keys list --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
    CV_ENDPOINT=$(az cognitiveservices account show --name "$COMPUTER_VISION_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
    if [ -n "$CV_KEY" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "VISION-KEY" --value "$CV_KEY" --output none 2>/dev/null || true
        log_ok "VISION-KEY"
    else
        log_warn "No se pudo extraer key de Computer Vision"
    fi
    if [ -n "$CV_ENDPOINT" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "VISION-ENDPOINT" --value "$CV_ENDPOINT" --output none 2>/dev/null || true
        log_ok "VISION-ENDPOINT"
    else
        log_warn "No se pudo extraer endpoint de Computer Vision"
    fi

    # ---- Speech Services (auto-extraido) ----
    log_info "Secreto: AZURE-SPEECH-KEY"
    SPEECH_KEY=$(az cognitiveservices account keys list --name "$SPEECH_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
    if [ -n "$SPEECH_KEY" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-SPEECH-KEY" --value "$SPEECH_KEY" --output none 2>/dev/null || true
        log_ok "AZURE-SPEECH-KEY"
    else
        log_warn "No se pudo extraer key de Speech Services"
    fi

    # ---- Azure Maps (auto-extraido) ----
    log_info "Secreto: AZURE-MAPS-KEY"
    MAPS_KEY=$(az maps account keys list --name "$MAPS_NAME" --resource-group "$RESOURCE_GROUP" --query primaryKey -o tsv 2>/dev/null || echo "")
    if [ -n "$MAPS_KEY" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-MAPS-KEY" --value "$MAPS_KEY" --output none 2>/dev/null || true
        log_ok "AZURE-MAPS-KEY"
    else
        log_warn "No se pudo extraer key de Azure Maps"
    fi

    # ---- Azure OpenAI (auto-extraido) ----
    log_info "Secreto: AZURE-OPENAI-KEY / AZURE-OPENAI-ENDPOINT"
    AOAI_KEY=$(az cognitiveservices account keys list --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
    AOAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
    if [ -n "$AOAI_KEY" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-OPENAI-KEY" --value "$AOAI_KEY" --output none 2>/dev/null || true
        log_ok "AZURE-OPENAI-KEY"
    else
        log_warn "No se pudo extraer key de Azure OpenAI (puede no existir en dev)"
    fi
    if [ -n "$AOAI_ENDPOINT" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-OPENAI-ENDPOINT" --value "$AOAI_ENDPOINT" --output none 2>/dev/null || true
        log_ok "AZURE-OPENAI-ENDPOINT"
    fi

    # ---- Azure OpenAI Whisper (auto-extraido, cuenta separada) ----
    log_info "Secreto: AZURE-AUDIO-KEY / AZURE-AUDIO-ENDPOINT"
    WHISPER_KEY=$(az cognitiveservices account keys list --name "$WHISPER_OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
    WHISPER_ENDPOINT=$(az cognitiveservices account show --name "$WHISPER_OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
    if [ -n "$WHISPER_KEY" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-AUDIO-KEY" --value "$WHISPER_KEY" --output none 2>/dev/null || true
        log_ok "AZURE-AUDIO-KEY"
    else
        log_warn "No se pudo extraer key de Whisper OpenAI (puede no estar desplegado)"
    fi
    if [ -n "$WHISPER_ENDPOINT" ]; then
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "AZURE-AUDIO-ENDPOINT" --value "$WHISPER_ENDPOINT" --output none 2>/dev/null || true
        log_ok "AZURE-AUDIO-ENDPOINT"
    fi

    # ---- Redis (solo si fue desplegado) ----
    if [ "${ENABLE_REDIS}" = "true" ]; then
        log_info "Secreto: REDIS-CONNECTION-STRING"
        REDIS_CONN=$(az redis list-keys --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query primaryKey -o tsv 2>/dev/null || echo "")
        REDIS_HOST=$(az redis show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query hostName -o tsv 2>/dev/null || echo "")
        REDIS_PORT=$(az redis show --name "$REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query sslPort -o tsv 2>/dev/null || echo "")
        if [ -n "$REDIS_CONN" ] && [ -n "$REDIS_HOST" ]; then
            REDIS_FULL="${REDIS_HOST}:${REDIS_PORT},password=${REDIS_CONN},ssl=True,abortConnect=False"
            az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "REDIS-CONNECTION-STRING" --value "$REDIS_FULL" --output none 2>/dev/null || true
            log_ok "REDIS-CONNECTION-STRING"
        else
            log_warn "No se pudo extraer conexion de Redis"
        fi
    fi

    # ---- Service Bus (solo si fue desplegado) ----
    if [ "${ENABLE_SERVICEBUS}" = "true" ]; then
        log_info "Secreto: SERVICE-BUS-CONNECTION-STRING"
        SB_CONN=$(az servicebus namespace authorization-rule keys list \
            --namespace-name "$SERVICE_BUS_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --name RootManageSharedAccessKey \
            --query primaryConnectionString -o tsv 2>/dev/null || echo "")
        if [ -n "$SB_CONN" ]; then
            az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "SERVICE-BUS-CONNECTION-STRING" --value "$SB_CONN" --output none 2>/dev/null || true
            log_ok "SERVICE-BUS-CONNECTION-STRING"
        else
            log_warn "No se pudo extraer conexion de Service Bus"
        fi
    fi

    log_ok "Key Vault poblado"
}

# ============================================================================
# CONFIGURACION EXTRA (settings no cubiertos por Bicep)
# ============================================================================

configure_extra_settings() {
    log_step "Configurando settings adicionales"

    # El Bicep ya configura: runtime, Key Vault refs, environment, storage
    # Aqui agregamos settings que dependen de config.env
    EXTRA_SETTINGS=()

    # AI Provider (depende del ambiente)
    [ -n "$AI_PROVIDER" ] && EXTRA_SETTINGS+=("AI_PROVIDER=${AI_PROVIDER}")
    [ -n "$USE_AI" ] && EXTRA_SETTINGS+=("USE_AI=${USE_AI}")

    # WhatsApp Phone ID (no es secreto, va directo)
    [ -n "$WHATSAPP_PHONE_ID" ] && EXTRA_SETTINGS+=("WHATSAPP_PHONE_ID=$WHATSAPP_PHONE_ID")
    # WHATSAPP_APP_SECRET ahora se maneja via Key Vault (ref en functionapp.bicep)

    # Audio transcription
    [ -n "$AUDIO_TRANSCRIPTION_ENABLED" ] && EXTRA_SETTINGS+=("AUDIO_TRANSCRIPTION_ENABLED=$AUDIO_TRANSCRIPTION_ENABLED")

    # Service Bus (la app lee SERVICEBUS_ENABLED, no ENABLE_SERVICEBUS)
    if [ "${ENABLE_SERVICEBUS}" = "true" ]; then
        EXTRA_SETTINGS+=("SERVICEBUS_ENABLED=true")
    fi

    # Timer schedules (requeridos por timer-session-cleanup y timer-survey-sender)
    EXTRA_SETTINGS+=("TIMER_SCHEDULE=${TIMER_SCHEDULE:-0 */5 * * * *}")
    EXTRA_SETTINGS+=("SURVEY_TIMER_SCHEDULE=${SURVEY_TIMER_SCHEDULE:-0 0 9 * * *}")

    # Gemini API Key (si se usa gemini como AI_PROVIDER)
    if [ -n "$GEMINI_API_KEY" ]; then
        # Guardar en Key Vault
        az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "GEMINI-API-KEY" --value "$GEMINI_API_KEY" --output none 2>/dev/null || true
        KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv 2>/dev/null)
        EXTRA_SETTINGS+=("GEMINI_API_KEY=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/GEMINI-API-KEY/)")
    fi

    if [ ${#EXTRA_SETTINGS[@]} -gt 0 ]; then
        log_info "Aplicando ${#EXTRA_SETTINGS[@]} settings adicionales..."
        az functionapp config appsettings set \
            --name "$FUNCTION_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --settings "${EXTRA_SETTINGS[@]}" \
            --output none
        log_ok "Settings adicionales aplicados"
    else
        log_info "No hay settings adicionales para aplicar"
    fi
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

    if [ -z "$SQLCMD" ]; then
        log_error "sqlcmd no encontrado"
        log_info "Instalar: brew install microsoft/mssql-release/mssql-tools18 (macOS)"
        log_info "O ejecutar el SQL manualmente en Azure Portal > Query Editor"
        return 1
    fi

    # Limpiar reglas de firewall antiguas del deploy script
    log_info "Limpiando reglas de firewall antiguas..."
    local OLD_RULES=$(az sql server firewall-rule list --server "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" --query "[?starts_with(name,'DeployScript-')].name" -o tsv 2>/dev/null || echo "")
    for rule in $OLD_RULES; do
        az sql server firewall-rule delete --name "$rule" --server "$SQL_SERVER_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null || true
    done

    # Agregar IP local al firewall de SQL Server
    log_info "Agregando IP local al firewall SQL..."
    LOCAL_IP=$(curl -s https://api.ipify.org 2>/dev/null || echo "")
    if [ -n "$LOCAL_IP" ]; then
        az sql server firewall-rule create \
            --name "DeployScript-Current" \
            --resource-group "$RESOURCE_GROUP" \
            --server "$SQL_SERVER_NAME" \
            --start-ip-address "$LOCAL_IP" \
            --end-ip-address "$LOCAL_IP" \
            --output none 2>/dev/null || log_warn "No se pudo agregar regla de firewall"
        log_ok "Firewall: IP $LOCAL_IP agregada"
    else
        log_warn "No se pudo obtener IP local. Si sqlcmd falla, agrega tu IP manualmente."
    fi

    log_info "Ejecutando script SQL (puede tardar 1-2 minutos)..."
    "$SQLCMD" -S "${SQL_SERVER_NAME}.database.windows.net" \
        -d "$SQL_DATABASE_NAME" \
        -U "${SQL_ADMIN_USER:-sqladmin}" \
        -P "$SQL_ADMIN_PASSWORD" \
        -i "$SQL_SCRIPT" \
        -C -l 60 || {
            log_error "Error ejecutando SQL"
            log_info "Alternativa: ejecuta el script en Azure Portal > SQL Database > Query Editor"
            return 1
        }

    log_ok "Base de datos inicializada"
}

# ============================================================================
# RESTART (para que Function App resuelva Key Vault refs post-secrets)
# ============================================================================

restart_function_app() {
    log_info "Reiniciando Function App para resolver referencias Key Vault..."
    az functionapp restart \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output none 2>/dev/null || log_warn "No se pudo reiniciar (puede no existir aun)"
    log_ok "Function App reiniciado"
}

# ============================================================================
# DEPLOY CODIGO
# ============================================================================

deploy_functions() {
    log_step "Desplegando Azure Functions (backend)"

    cd "$PROJECT_ROOT"

    # Usar staging dir para no tocar node_modules local
    local STAGE_DIR
    STAGE_DIR=$(mktemp -d)
    local DEPLOY_ZIP="/tmp/signbot-deploy-$$.zip"

    # Copiar fuentes al directorio de staging (sin node_modules ni archivos dev)
    log_info "Preparando paquete de deployment..."

    # Excluir queue-message-processor si Service Bus no esta habilitado
    # (evita error "listener was unable to start" con connection string vacia)
    local SB_EXCLUDE=""
    if [ "${ENABLE_SERVICEBUS}" != "true" ]; then
        SB_EXCLUDE="--exclude=queue-message-processor"
        log_info "Service Bus no habilitado — excluyendo queue-message-processor"
    fi

    rsync -a \
        $SB_EXCLUDE \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='node_modules_deploy_backup' \
        --exclude='tests' \
        --exclude='coverage' \
        --exclude='.nyc_output' \
        --exclude='docs' \
        --exclude='scripts' \
        --exclude='sql-scripts' \
        --exclude='infra' \
        --exclude='frontend' \
        --exclude='types' \
        --exclude='dist' \
        --exclude='.vscode' \
        --exclude='.cursor' \
        --exclude='.claude' \
        --exclude='.husky' \
        --exclude='.env*' \
        --exclude='*.env' \
        --exclude='local.settings.json*' \
        --exclude='*.test.js' \
        --exclude='*.test.ts' \
        --exclude='*.md' \
        --exclude='tsconfig.json' \
        --exclude='jsconfig.json' \
        --exclude='jest.config.js' \
        --exclude='eslint.config.js' \
        --exclude='.prettierrc' \
        --exclude='.prettierignore' \
        --exclude='*.d.ts' \
        --exclude='*.ts' \
        --exclude='*.zip' \
        --exclude='*.log' \
        --exclude='*.tmp' \
        --exclude='.DS_Store' \
        "$PROJECT_ROOT/" "$STAGE_DIR/"

    # Instalar solo dependencias de produccion en staging (no toca local node_modules)
    log_info "Instalando dependencias de produccion..."
    (cd "$STAGE_DIR" && npm ci --omit=dev --silent)

    # Crear zip desde staging
    rm -f "$DEPLOY_ZIP"
    (cd "$STAGE_DIR" && zip -rq "$DEPLOY_ZIP" .)

    local DEPLOY_SIZE
    DEPLOY_SIZE=$(du -h "$DEPLOY_ZIP" | cut -f1)
    log_info "Paquete: $DEPLOY_SIZE"

    # Subir zip a Azure (deps ya incluidas, sin build remoto)
    log_info "Subiendo a Azure (zip deploy)..."
    az functionapp deployment source config-zip \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --src "$DEPLOY_ZIP" \
        --timeout 300 \
        --output none

    # Limpiar
    rm -f "$DEPLOY_ZIP"
    rm -rf "$STAGE_DIR"
    cd "$PROJECT_ROOT"

    log_ok "Functions desplegadas"
}

deploy_frontend() {
    log_step "Desplegando Static Web App (frontend)"

    FRONTEND_DIR="$PROJECT_ROOT/frontend"

    if [ ! -d "$FRONTEND_DIR" ]; then
        log_warn "Directorio frontend/ no existe — omitiendo deploy de frontend"
        return 0
    fi

    cd "$FRONTEND_DIR"

    # Obtener deployment token de SWA
    local SWA_TOKEN
    SWA_TOKEN=$(az staticwebapp secrets list --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.apiKey" -o tsv 2>/dev/null || echo "")

    if [ -z "$SWA_TOKEN" ]; then
        log_warn "No se pudo obtener token de SWA. Despliega manualmente con:"
        log_info "  cd frontend && swa deploy --deployment-token <TOKEN>"
        return 0
    fi

    # Build si tiene package.json (frameworks como React/Vue/Next)
    if [ -f "package.json" ]; then
        log_info "Instalando dependencias del frontend..."
        npm ci --silent
        log_info "Construyendo frontend..."
        npm run build
    fi

    # Detectar directorio de output (frameworks) o usar directorio actual (static)
    local OUTPUT_DIR="$FRONTEND_DIR"
    [ -d "dist" ] && OUTPUT_DIR="dist"
    [ -d "build" ] && OUTPUT_DIR="build"
    [ -d "out" ] && OUTPUT_DIR="out"

    log_info "Desplegando desde $OUTPUT_DIR..."
    if command -v swa &>/dev/null; then
        swa deploy "$OUTPUT_DIR" --deployment-token "$SWA_TOKEN" --env production
    else
        log_warn "Azure SWA CLI no instalado. Instalar: npm i -g @azure/static-web-apps-cli"
        log_info "Alternativa: sube el directorio $OUTPUT_DIR desde Azure Portal"
        return 0
    fi

    log_ok "Frontend desplegado"
}

# ============================================================================
# VERIFICACION
# ============================================================================

verify_deployment() {
    log_step "Verificando deployment"

    FUNCTION_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"

    # Polling sin sleep fijo — intenta inmediatamente, luego con backoff
    local max_retries=6
    local wait_secs=5

    for i in $(seq 1 $max_retries); do
        log_info "Health check intento $i/$max_retries..."
        RESPONSE=$(curl -sf --max-time 10 "${FUNCTION_URL}/api/health" 2>/dev/null || echo "")

        if echo "$RESPONSE" | grep -q '"status":"healthy"' 2>/dev/null; then
            log_ok "Health check: healthy"
            break
        elif echo "$RESPONSE" | grep -q '"status":"degraded"' 2>/dev/null; then
            log_ok "Health check: degraded (aceptable)"
            break
        fi

        if [ $i -eq $max_retries ]; then
            log_warn "Health check no respondio despues de $max_retries intentos"
            log_info "La app puede tardar unos minutos mas en iniciar (cold start)"
        else
            sleep $wait_secs
            wait_secs=$((wait_secs + 5)) # backoff: 5, 10, 15, 20, 25
        fi
    done

    # Listar funciones
    log_info "Funciones desplegadas:"
    az functionapp function list \
        --resource-group "$RESOURCE_GROUP" \
        --name "$FUNCTION_APP_NAME" \
        --query "[].name" -o tsv 2>/dev/null || log_warn "No se pudieron listar (normal en primer deploy)"
}

# ============================================================================
# RESUMEN
# ============================================================================

show_summary() {
    SWA_URL=$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostname -o tsv 2>/dev/null || echo "")

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}DEPLOY COMPLETADO EXITOSAMENTE${NC}"
    echo "============================================================================"
    echo ""
    echo "  Ambiente:      $ENVIRONMENT"
    echo "  Resource Group: $RESOURCE_GROUP"
    echo ""
    echo -e "  ${CYAN}URLs:${NC}"
    echo "  Function App:  https://${FUNCTION_APP_NAME}.azurewebsites.net"
    echo "  Health Check:  https://${FUNCTION_APP_NAME}.azurewebsites.net/api/health"
    echo "  Webhook:       https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    [ -n "$SWA_URL" ] && echo "  Dashboard:     https://${SWA_URL}"
    echo ""
    echo -e "  ${CYAN}Siguiente paso - Configurar WhatsApp:${NC}"
    echo "    1. Ir a https://developers.facebook.com"
    echo "    2. Tu App > WhatsApp > Configuration"
    echo "    3. Callback URL: https://${FUNCTION_APP_NAME}.azurewebsites.net/api/whatsapp-webhook"
    [ -n "$WHATSAPP_VERIFY_TOKEN" ] && echo "    4. Verify Token: $WHATSAPP_VERIFY_TOKEN"
    echo ""
    echo -e "  ${CYAN}Comandos utiles:${NC}"
    echo "    Ver logs:     az functionapp log tail --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP"
    echo "    Re-deploy:    ./scripts/azure/deploy.sh $ENVIRONMENT --code-only"
    echo "    Destruir:     ./scripts/azure/destroy.sh $ENVIRONMENT"
    echo ""
    echo "  Outputs guardados en: scripts/azure/outputs-${ENVIRONMENT}.env"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    DEPLOY_START_TIME=$(date +%s)

    echo ""
    echo "============================================================================"
    echo "  Sign Bot - Instalador Azure"
    echo "  Infraestructura + Secretos + Base de Datos + Codigo"
    echo "============================================================================"
    echo ""

    load_environment
    check_prerequisites

    # --- Modo: Validate / What-If (no necesita secretos) ---
    if [ "$VALIDATE_ONLY" = true ] || [ "$WHAT_IF" = true ]; then
        prompt_secrets
        deploy_bicep
        show_timing_summary
        return 0
    fi

    # --- Modo: Code Only (functions + frontend) ---
    if [ "$CODE_ONLY" = true ]; then
        configure_extra_settings
        deploy_functions
        verify_deployment
        deploy_frontend
        show_timing_summary
        show_summary
        return 0
    fi

    # --- Modo: Functions Only ---
    if [ "$FUNCTIONS_ONLY" = true ]; then
        configure_extra_settings
        deploy_functions
        verify_deployment
        show_timing_summary
        show_summary
        return 0
    fi

    # --- Modo: Frontend Only ---
    if [ "$FRONTEND_ONLY" = true ]; then
        deploy_frontend
        show_timing_summary
        return 0
    fi

    # --- Modo: DB Only ---
    if [ "$DB_ONLY" = true ]; then
        prompt_secrets
        init_database
        show_timing_summary
        return 0
    fi

    # --- Modo: Secrets Only ---
    if [ "$SECRETS_ONLY" = true ]; then
        prompt_secrets
        populate_key_vault
        configure_extra_settings
        restart_function_app
        show_timing_summary
        return 0
    fi

    # --- Modo: Infra Only ---
    if [ "$INFRA_ONLY" = true ]; then
        prompt_secrets
        preflight_cleanup
        deploy_bicep
        populate_key_vault
        configure_extra_settings
        restart_function_app
        show_timing_summary
        show_summary
        return 0
    fi

    # --- Modo: Deploy Completo ---
    prompt_secrets
    preflight_cleanup
    deploy_bicep
    populate_key_vault
    configure_extra_settings
    restart_function_app
    init_database
    deploy_functions
    verify_deployment
    deploy_frontend
    show_timing_summary
    show_summary
}

main "$@"
