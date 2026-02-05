#!/bin/bash
# ============================================================================
# AC FIXBOT - Configurar Easy Auth solamente
# Este script configura Azure AD Authentication sin recrear otros recursos
# ============================================================================

set -e

# Colores para output
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

# Verificar Azure CLI
if ! command -v az &> /dev/null; then
    log_error "Azure CLI no está instalado"
    exit 1
fi

if ! az account show &> /dev/null; then
    log_error "No hay sesión activa en Azure. Ejecuta: az login"
    exit 1
fi

# Cargar configuración
CONFIG_FILE="${SCRIPT_DIR}/config.env"
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Archivo de configuración no encontrado: $CONFIG_FILE"
    exit 1
fi

source "$CONFIG_FILE"

# Variables derivadas
KEY_VAULT_NAME="kv-acfixbot-${ENVIRONMENT}"
KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query properties.vaultUri -o tsv 2>/dev/null)

if [ -z "$KEY_VAULT_URI" ]; then
    log_error "No se encontró Key Vault: $KEY_VAULT_NAME"
    exit 1
fi

log_info "Configuración cargada"
log_info "  Resource Group: $RESOURCE_GROUP"
log_info "  Function App: $FUNCTION_APP_NAME"
log_info "  Key Vault: $KEY_VAULT_NAME"

# Verificar que ENABLE_EASY_AUTH esté habilitado
if [[ "${ENABLE_EASY_AUTH:-false}" != "true" ]]; then
    log_error "Easy Auth no está habilitado. Agrega ENABLE_EASY_AUTH=\"true\" en config.env"
    exit 1
fi

echo ""
log_info "Configurando Azure AD Authentication (Easy Auth)..."
echo ""

# Variables de Easy Auth
AAD_APP_NAME="${AAD_APP_NAME:-AC FixBot Dashboard - ${ENVIRONMENT}}"
FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
AAD_REDIRECT_URI="${FUNCTION_APP_URL}/.auth/login/aad/callback"

# Verificar si la App Registration ya existe
EXISTING_APP_ID=$(az ad app list --display-name "$AAD_APP_NAME" --query "[0].appId" -o tsv 2>/dev/null)

if [ -n "$EXISTING_APP_ID" ] && [ "$EXISTING_APP_ID" != "null" ]; then
    log_warning "App Registration '$AAD_APP_NAME' ya existe"
    AAD_CLIENT_ID="$EXISTING_APP_ID"
else
    log_info "Creando App Registration: $AAD_APP_NAME..."
    AAD_CLIENT_ID=$(az ad app create \
        --display-name "$AAD_APP_NAME" \
        --web-redirect-uris "$AAD_REDIRECT_URI" \
        --sign-in-audience "AzureADMyOrg" \
        --query appId -o tsv)

    if [ -z "$AAD_CLIENT_ID" ]; then
        log_error "No se pudo crear App Registration"
        exit 1
    fi
    log_success "App Registration creada: $AAD_CLIENT_ID"

    # Habilitar ID tokens y Access tokens (requerido para Easy Auth)
    log_info "Habilitando ID tokens y Access tokens..."
    az ad app update --id "$AAD_CLIENT_ID" --enable-id-token-issuance true --enable-access-token-issuance true
    log_success "Tokens habilitados"
fi

# Crear Client Secret
log_info "Generando Client Secret..."
AAD_CLIENT_SECRET=$(az ad app credential reset \
    --id "$AAD_CLIENT_ID" \
    --append \
    --display-name "easy-auth-${ENVIRONMENT}" \
    --years 2 \
    --query password -o tsv 2>/dev/null)

if [ -z "$AAD_CLIENT_SECRET" ]; then
    AAD_CLIENT_SECRET=$(az ad app credential reset \
        --id "$AAD_CLIENT_ID" \
        --query password -o tsv 2>/dev/null)
fi

if [ -z "$AAD_CLIENT_SECRET" ]; then
    log_error "No se pudo obtener Client Secret"
    exit 1
fi
log_success "Client Secret generado"

# Guardar en Key Vault
log_info "Guardando Client Secret en Key Vault..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "AAD-CLIENT-SECRET" \
    --value "$AAD_CLIENT_SECRET" \
    --output none

# Obtener Tenant ID
TENANT_ID=$(az account show --query tenantId -o tsv)

# Configurar Easy Auth via REST API
log_info "Habilitando Easy Auth en Function App..."

ACCESS_TOKEN=$(az account get-access-token --query accessToken -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

AUTH_CONFIG=$(cat <<EOF
{
    "properties": {
        "platform": {
            "enabled": true
        },
        "globalValidation": {
            "requireAuthentication": true,
            "unauthenticatedClientAction": "RedirectToLoginPage",
            "redirectToProvider": "azureactivedirectory",
            "excludedPaths": [
                "/api/whatsapp-webhook",
                "/api/health",
                "/api/conversations",
                "/api/conversations/*",
                "/api/ticket-resolve",
                "/api/ticket-resolve/*",
                "/api/admin-cache",
                "/api/admin-cache/*",
                "/api/metrics",
                "/api/metrics/*"
            ]
        },
        "identityProviders": {
            "azureActiveDirectory": {
                "enabled": true,
                "registration": {
                    "openIdIssuer": "https://sts.windows.net/${TENANT_ID}/v2.0",
                    "clientId": "${AAD_CLIENT_ID}",
                    "clientSecretSettingName": "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET"
                },
                "validation": {
                    "allowedAudiences": [
                        "api://${AAD_CLIENT_ID}"
                    ]
                },
                "login": {
                    "loginParameters": ["scope=openid profile email"]
                }
            }
        },
        "login": {
            "tokenStore": {
                "enabled": true
            }
        }
    }
}
EOF
)

curl -s -X PUT \
    "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${FUNCTION_APP_NAME}/config/authsettingsV2?api-version=2022-03-01" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$AUTH_CONFIG" > /dev/null

# Configurar App Setting
log_info "Configurando Client Secret en App Settings..."
az functionapp config appsettings set \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET=@Microsoft.KeyVault(SecretUri=${KEY_VAULT_URI}secrets/AAD-CLIENT-SECRET/)" \
    --output none

echo ""
log_success "Easy Auth configurado correctamente!"
echo ""
echo "============================================"
echo "  Configuración de Easy Auth"
echo "============================================"
echo "  App Registration: $AAD_APP_NAME"
echo "  Client ID: $AAD_CLIENT_ID"
echo "  Tenant ID: $TENANT_ID"
echo "  Redirect URI: $AAD_REDIRECT_URI"
echo ""
echo "  Dashboard URL: ${FUNCTION_APP_URL}/api/dashboard"
echo ""
echo "  Rutas PROTEGIDAS (requieren login):"
echo "    - /api/dashboard"
echo ""
echo "  Rutas EXCLUIDAS (sin auth):"
echo "    - /api/whatsapp-webhook"
echo "    - /api/health"
echo "    - /api/conversations/*"
echo "    - /api/ticket-resolve/*"
echo "    - /api/metrics/*"
echo ""
echo "  Los usuarios ahora deberán iniciar sesión con"
echo "  su cuenta de Microsoft/Azure AD para acceder"
echo "  al dashboard."
echo "============================================"
