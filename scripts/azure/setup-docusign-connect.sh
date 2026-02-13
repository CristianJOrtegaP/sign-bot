#!/bin/bash
# ============================================================================
# Sign Bot - DocuSign Connect Webhook Setup
# ============================================================================
# Configura el webhook de DocuSign Connect para recibir notificaciones
# de eventos de envelopes (completed, declined, voided).
#
# Este script NO es parte del IaC de Bicep porque DocuSign Connect
# es un recurso externo (no Azure). Debe ejecutarse una vez por ambiente
# después del deploy de infraestructura.
#
# Uso:
#   ./setup-docusign-connect.sh [ambiente]
#
# Ambientes: dev, tst, prod
#
# Prerequisitos:
#   - Azure CLI autenticado
#   - Key Vault con secretos de DocuSign configurados
#   - Function App desplegada con api-docusign-webhook
#   - Node.js instalado
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Ambiente
ENV="${1:-dev}"
case "$ENV" in
  dev|development) ENV_SUFFIX="development" ;;
  tst|test)        ENV_SUFFIX="test" ;;
  prod|production) ENV_SUFFIX="production" ;;
  *)
    echo -e "${RED}Ambiente invalido: $ENV. Usa: dev, tst, prod${NC}"
    exit 1
    ;;
esac

RG="rg-signbot-${ENV_SUFFIX}"
FUNC_APP="func-signbot-${ENV_SUFFIX}"
KV="kv-signbot-${ENV_SUFFIX}"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN} DocuSign Connect Setup - ${ENV_SUFFIX}${NC}"
echo -e "${CYAN}========================================${NC}"

# 1. Obtener secretos de Key Vault
echo -e "${YELLOW}Obteniendo credenciales de DocuSign...${NC}"
DS_INTEGRATION_KEY=$(az keyvault secret show --vault-name "$KV" --name DOCUSIGN-INTEGRATION-KEY --query value -o tsv)
DS_USER_ID=$(az keyvault secret show --vault-name "$KV" --name DOCUSIGN-USER-ID --query value -o tsv)
DS_ACCOUNT_ID=$(az keyvault secret show --vault-name "$KV" --name DOCUSIGN-ACCOUNT-ID --query value -o tsv)
DS_RSA_KEY=$(az keyvault secret show --vault-name "$KV" --name DOCUSIGN-RSA-PRIVATE-KEY --query value -o tsv)
DS_BASE_URL=$(az keyvault secret show --vault-name "$KV" --name DOCUSIGN-BASE-URL --query value -o tsv)

# Determinar OAuth host segun ambiente
if echo "$DS_BASE_URL" | grep -q "demo"; then
  DS_OAUTH_HOST="account-d.docusign.com"
  DS_API_HOST="demo.docusign.net"
else
  DS_OAUTH_HOST="account.docusign.com"
  DS_API_HOST="docusign.net"
fi

echo -e "  Account ID: ${DS_ACCOUNT_ID:0:8}..."
echo -e "  OAuth Host: $DS_OAUTH_HOST"
echo -e "  API Host:   $DS_API_HOST"

# 2. Obtener function key del webhook
echo -e "${YELLOW}Obteniendo function key del webhook...${NC}"
WEBHOOK_KEY=$(az functionapp function keys list \
  --name "$FUNC_APP" \
  --resource-group "$RG" \
  --function-name api-docusign-webhook \
  --query default -o tsv)

WEBHOOK_URL="https://${FUNC_APP}.azurewebsites.net/api/docusign-webhook?code=${WEBHOOK_KEY}"
echo -e "  Webhook URL: ${WEBHOOK_URL:0:70}..."

# 3. Guardar RSA key temporalmente
RSA_KEY_FILE=$(mktemp)
echo "$DS_RSA_KEY" > "$RSA_KEY_FILE"

# 4. Crear DocuSign Connect via Node.js
echo -e "${YELLOW}Configurando DocuSign Connect...${NC}"

CONNECT_RESULT=$(node << NODESCRIPT
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const privateKey = fs.readFileSync('${RSA_KEY_FILE}', 'utf8');
const integrationKey = '${DS_INTEGRATION_KEY}';
const userId = '${DS_USER_ID}';
const accountId = '${DS_ACCOUNT_ID}';
const oauthHost = '${DS_OAUTH_HOST}';
const apiHost = '${DS_API_HOST}';
const webhookUrl = '${WEBHOOK_URL}';

// Generate JWT
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  iss: integrationKey, sub: userId,
  aud: oauthHost,
  iat: now, exp: now + 3600,
  scope: 'signature impersonation'
})).toString('base64url');
const sig = crypto.sign('RSA-SHA256', Buffer.from(header+'.'+payload), privateKey).toString('base64url');
const jwt = header+'.'+payload+'.'+sig;

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // Get access token
  const tokenData = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion='+jwt;
  const tokenRes = await makeRequest({
    hostname: oauthHost, path: '/oauth/token', method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(tokenData)}
  }, tokenData);

  const token = JSON.parse(tokenRes.body).access_token;
  if (!token) { console.log('ERROR:No token: '+tokenRes.body); process.exit(1); }

  // Check existing Connect configs
  const existingRes = await makeRequest({
    hostname: apiHost, path: '/restapi/v2.1/accounts/'+accountId+'/connect', method: 'GET',
    headers: { 'Authorization': 'Bearer '+token }
  });

  const existing = JSON.parse(existingRes.body);
  let existingId = null;
  if (existing.configurations) {
    for (const c of existing.configurations) {
      if (c.name === 'SignBot Webhook') {
        existingId = c.connectId;
        break;
      }
    }
  }

  // Create or update Connect configuration
  const connectConfig = JSON.stringify({
    ...(existingId ? { connectId: existingId } : {}),
    configurationType: 'custom',
    name: 'SignBot Webhook',
    urlToPublishTo: webhookUrl,
    allowEnvelopePublish: 'true',
    enableLog: 'true',
    requiresAcknowledgement: 'true',
    allUsers: 'true',
    includeEnvelopeVoidReason: 'true',
    deliveryMode: 'SIM',
    eventData: {
      version: 'restv2.1',
      format: 'json',
      includeData: ['recipients']
    },
    events: ['envelope-completed', 'envelope-declined', 'envelope-voided']
  });

  const method = existingId ? 'PUT' : 'POST';
  const connectRes = await makeRequest({
    hostname: apiHost,
    path: '/restapi/v2.1/accounts/'+accountId+'/connect',
    method: method,
    headers: {
      'Authorization': 'Bearer '+token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(connectConfig)
    }
  }, connectConfig);

  const result = JSON.parse(connectRes.body);
  if (result.connectId) {
    console.log('OK:'+result.connectId+':'+(existingId ? 'updated' : 'created'));
  } else {
    console.log('ERROR:'+connectRes.status+':'+result.errorCode+':'+result.message);
  }
}

main().catch(e => { console.log('ERROR:'+e.message); process.exit(1); });
NODESCRIPT
)

# Cleanup RSA key
rm -f "$RSA_KEY_FILE"

# 5. Verificar resultado
if echo "$CONNECT_RESULT" | grep -q "^OK:"; then
  CONNECT_ID=$(echo "$CONNECT_RESULT" | cut -d: -f2)
  ACTION=$(echo "$CONNECT_RESULT" | cut -d: -f3)
  echo -e "${GREEN}DocuSign Connect ${ACTION} exitosamente${NC}"
  echo -e "  Connect ID: $CONNECT_ID"
  echo -e "  Events: envelope-completed, envelope-declined, envelope-voided"
  echo -e "  Delivery Mode: SIM (JSON v2.1)"
else
  echo -e "${RED}Error configurando DocuSign Connect:${NC}"
  echo -e "  $CONNECT_RESULT"
  exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} DocuSign Connect configurado!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Notas para produccion:"
echo -e "  1. Configurar HMAC secret en DocuSign Admin UI"
echo -e "  2. Remover SKIP_DOCUSIGN_HMAC_VALIDATION de las app settings"
echo -e "  3. Verificar que el webhook secret en Key Vault coincida"
