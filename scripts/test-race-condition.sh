#!/bin/bash
# Script para simular race condition con múltiples webhooks concurrentes

echo "=========================================="
echo "SMOKE TEST - Race Condition"
echo "=========================================="
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Variables
WEBHOOK_URL="http://localhost:7071/api/whatsapp-webhook"
TEST_PHONE="+5215512345678"

echo "📍 Configuración:"
echo "   URL: $WEBHOOK_URL"
echo "   Teléfono: $TEST_PHONE"
echo ""

echo "⚠️  ADVERTENCIA:"
echo "   Este test envía 5 webhooks concurrentes al mismo teléfono"
echo "   para simular race condition y validar optimistic locking."
echo ""
read -p "   Presiona ENTER para continuar..."
echo ""

# Crear 5 webhooks concurrentes con diferentes message IDs
echo "Test: Enviando 5 webhooks concurrentes..."
echo "----------------------------------------"

TIMESTAMP=$(date +%s)

# Función para enviar webhook
send_webhook() {
    local MESSAGE_ID="wamid.RACE_${TIMESTAMP}_$1"
    local MESSAGE_BODY="Mensaje concurrente $1"

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST $WEBHOOK_URL \
      -H "Content-Type: application/json" \
      -d "{
        \"entry\": [{
          \"changes\": [{
            \"value\": {
              \"messages\": [{
                \"id\": \"$MESSAGE_ID\",
                \"from\": \"$TEST_PHONE\",
                \"timestamp\": \"$TIMESTAMP\",
                \"type\": \"text\",
                \"text\": {
                  \"body\": \"$MESSAGE_BODY\"
                }
              }],
              \"metadata\": {
                \"display_phone_number\": \"123456789\",
                \"phone_number_id\": \"987654321\"
              }
            }
          }]
        }]
      }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

    echo "Webhook $1: HTTP $HTTP_CODE"
}

# Enviar 5 webhooks en paralelo
send_webhook 1 &
send_webhook 2 &
send_webhook 3 &
send_webhook 4 &
send_webhook 5 &

# Esperar a que todos terminen
wait

echo ""
echo "✅ Webhooks enviados"
echo ""

# Esperar 3 segundos para que procesen
echo "⏳ Esperando 3 segundos para que procesen..."
sleep 3
echo ""

echo "=========================================="
echo "VERIFICACIÓN ESPERADA"
echo "=========================================="
echo ""
echo "En los logs de Azure Functions debes ver:"
echo ""
echo "1. Optimistic Locking funcionando:"
echo "   ${GREEN}✅${NC} Solo 1 webhook actualiza la sesión primero"
echo "   ${GREEN}✅${NC} Los otros 4 lanzan ConcurrencyError y reintentan"
echo "   ${GREEN}✅${NC} Todos eventualmente tienen éxito (con retry)"
echo "   ${GREEN}✅${NC} Version incrementa de 0 → 5"
echo ""
echo "2. Logs esperados:"
echo "   [ConcurrencyRetry] updateSession(...) - Intento 1/3 falló"
echo "   [ConcurrencyRetry] updateSession(...) - Intento 2/3 falló"
echo "   ✅ Sesión actualizada: ... -> [ESTADO]"
echo ""
echo "3. Deduplicación:"
echo "   ${GREEN}✅${NC} Cada webhook con messageId único se procesa"
echo "   ${GREEN}✅${NC} NO se marcan como duplicados (IDs diferentes)"
echo ""
echo "4. Circuit Breaker:"
echo "   ${GREEN}✅${NC} NO debe abrirse (ConcurrencyError es retryable)"
echo "   ${GREEN}✅${NC} Estado permanece en CLOSED"
echo ""
echo "=========================================="
echo ""
echo "Para ver logs detallados ejecuta:"
echo "  func host start --verbose"
echo ""
echo "Query SQL para verificar Version final:"
echo "  SELECT Telefono, Version, Estado"
echo "  FROM SesionesChat"
echo "  WHERE Telefono = '$TEST_PHONE'"
echo ""
echo "=========================================="
