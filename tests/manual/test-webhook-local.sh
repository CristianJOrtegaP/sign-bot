#!/bin/bash
# Script para testear webhook localmente

echo "=========================================="
echo "SMOKE TEST - Webhook Local"
echo "=========================================="
echo ""

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Variables
WEBHOOK_URL="http://localhost:7071/api/whatsapp-webhook"
TEST_PHONE="+5215512345678"
TEST_MESSAGE_ID="wamid.TEST_$(date +%s)"

echo "📍 Configuración:"
echo "   URL: $WEBHOOK_URL"
echo "   Teléfono: $TEST_PHONE"
echo "   Message ID: $TEST_MESSAGE_ID"
echo ""

# Test 1: Mensaje nuevo (debe procesarse)
echo "Test 1: Enviando mensaje nuevo..."
echo "----------------------------------------"

RESPONSE_1=$(curl -s -w "\n%{http_code}" -X POST $WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"entry\": [{
      \"changes\": [{
        \"value\": {
          \"messages\": [{
            \"id\": \"$TEST_MESSAGE_ID\",
            \"from\": \"$TEST_PHONE\",
            \"timestamp\": \"$(date +%s)\",
            \"type\": \"text\",
            \"text\": {
              \"body\": \"Hola, mi refrigerador no enfría\"
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

HTTP_CODE_1=$(echo "$RESPONSE_1" | tail -n 1)
BODY_1=$(echo "$RESPONSE_1" | sed '$d')

echo "HTTP Status: $HTTP_CODE_1"
echo "Response: $BODY_1"

if [ "$HTTP_CODE_1" = "200" ]; then
    echo -e "${GREEN}✅ Mensaje 1 procesado correctamente${NC}"
else
    echo -e "${RED}❌ ERROR: Mensaje 1 falló (HTTP $HTTP_CODE_1)${NC}"
fi
echo ""

# Esperar 2 segundos
echo "⏳ Esperando 2 segundos antes del siguiente test..."
sleep 2
echo ""

# Test 2: Mismo mensaje (debe detectarse como duplicado)
echo "Test 2: Enviando mismo mensaje (duplicado)..."
echo "----------------------------------------"

RESPONSE_2=$(curl -s -w "\n%{http_code}" -X POST $WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"entry\": [{
      \"changes\": [{
        \"value\": {
          \"messages\": [{
            \"id\": \"$TEST_MESSAGE_ID\",
            \"from\": \"$TEST_PHONE\",
            \"timestamp\": \"$(date +%s)\",
            \"type\": \"text\",
            \"text\": {
              \"body\": \"Hola, mi refrigerador no enfría\"
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

HTTP_CODE_2=$(echo "$RESPONSE_2" | tail -n 1)
BODY_2=$(echo "$RESPONSE_2" | sed '$d')

echo "HTTP Status: $HTTP_CODE_2"
echo "Response: $BODY_2"

if [ "$HTTP_CODE_2" = "200" ]; then
    echo -e "${GREEN}✅ Mensaje 2 devolvió 200 OK (idempotencia correcta)${NC}"
else
    echo -e "${YELLOW}⚠️  WARNING: Mensaje 2 devolvió HTTP $HTTP_CODE_2${NC}"
fi
echo ""

# Test 3: Nuevo mensaje diferente
NEW_MESSAGE_ID="wamid.TEST_$(date +%s)_2"
echo "Test 3: Enviando nuevo mensaje diferente..."
echo "   Message ID: $NEW_MESSAGE_ID"
echo "----------------------------------------"

RESPONSE_3=$(curl -s -w "\n%{http_code}" -X POST $WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"entry\": [{
      \"changes\": [{
        \"value\": {
          \"messages\": [{
            \"id\": \"$NEW_MESSAGE_ID\",
            \"from\": \"$TEST_PHONE\",
            \"timestamp\": \"$(date +%s)\",
            \"type\": \"text\",
            \"text\": {
              \"body\": \"Ahora el congelador tampoco funciona\"
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

HTTP_CODE_3=$(echo "$RESPONSE_3" | tail -n 1)
BODY_3=$(echo "$RESPONSE_3" | sed '$d')

echo "HTTP Status: $HTTP_CODE_3"
echo "Response: $BODY_3"

if [ "$HTTP_CODE_3" = "200" ]; then
    echo -e "${GREEN}✅ Mensaje 3 procesado correctamente${NC}"
else
    echo -e "${RED}❌ ERROR: Mensaje 3 falló (HTTP $HTTP_CODE_3)${NC}"
fi
echo ""

# Resumen
echo "=========================================="
echo "RESUMEN DE TESTS"
echo "=========================================="
echo ""
echo "✅ Qué verificar en Application Insights / Logs:"
echo ""
echo "1. Deduplicación:"
echo "   - Mensaje 1: debe procesarse normalmente"
echo "   - Mensaje 2: debe ver 'Mensaje duplicado detectado (MERGE)'"
echo "   - Reintentos debe incrementarse a 1"
echo ""
echo "2. Optimistic Locking:"
echo "   - Version debe incrementarse en cada actualización de sesión"
echo "   - NO debe haber ConcurrencyError (solo 1 webhook a la vez)"
echo ""
echo "3. Timeouts:"
echo "   - Llamadas AI deben completarse en <5s"
echo "   - NO debe haber TimeoutError en logs"
echo ""
echo "4. Circuit Breaker:"
echo "   - Estado debe permanecer en CLOSED"
echo "   - NO debe haber CircuitBreakerOpenError"
echo ""
echo "=========================================="
echo "Para ver logs detallados:"
echo "  func host start --verbose"
echo "=========================================="
