/**
 * Test directo de la función webhook sin HTTP
 * Omite validación de firma para testing local
 */

// Configurar variables de entorno mínimas ANTES de importar módulos
process.env.SKIP_SIGNATURE_VALIDATION = 'true';
process.env.VISION_ENDPOINT = 'https://dummy.cognitiveservices.azure.com/';
process.env.VISION_KEY = 'dummy_key_for_testing';
process.env.WHATSAPP_TOKEN = 'dummy_token';
process.env.WHATSAPP_PHONE_ID = '123456789';
process.env.USE_AI = 'false'; // Desactivar AI para testing
process.env.AI_PROVIDER = 'gemini';

// Mock de context compatible con Azure Functions
const context = {
    log: (...args) => console.log('[LOG]', ...args),
    res: {}
};
// Azure Functions usa context.log.warn() y context.log.error()
context.log.warn = (...args) => console.warn('[WARN]', ...args);
context.log.error = (...args) => console.error('[ERROR]', ...args);

// Mock de request compatible con webhook de WhatsApp
function createMockRequest(messageId, phone, body) {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: {
            object: 'whatsapp_business_account', // Campo requerido por webhook
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            id: messageId,
                            from: phone,
                            timestamp: Math.floor(Date.now() / 1000).toString(),
                            type: 'text',
                            text: { body }
                        }],
                        metadata: {
                            display_phone_number: '123456789',
                            phone_number_id: '987654321'
                        }
                    }
                }]
            }]
        }
    };
}

async function runTests() {
    console.log('==========================================');
    console.log('SMOKE TEST - Llamada Directa a Función');
    console.log('==========================================\n');

    const webhookHandler = require('../api-whatsapp-webhook/index');
    const testPhone = '+5215512345678';
    const messageId1 = `wamid.TEST_${Date.now()}`;

    // Test 1: Mensaje nuevo
    console.log('Test 1: Mensaje nuevo...');
    console.log('----------------------------------------');
    const req1 = createMockRequest(messageId1, testPhone, 'Hola, mi refrigerador no enfría');

    await webhookHandler(context, req1);

    console.log(`HTTP Status: ${context.res.status || 200}`);
    console.log(`Response: ${context.res.body || 'OK'}`);

    if (context.res.status === 200 || !context.res.status) {
        console.log('✅ Mensaje 1 procesado correctamente\n');
    } else {
        console.log(`❌ ERROR: Mensaje 1 falló (HTTP ${context.res.status})\n`);
    }

    // Esperar 2 segundos
    console.log('⏳ Esperando 2 segundos...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Mismo mensaje (duplicado)
    console.log('Test 2: Mismo mensaje (duplicado)...');
    console.log('----------------------------------------');
    const req2 = createMockRequest(messageId1, testPhone, 'Hola, mi refrigerador no enfría');

    context.res = {};
    await webhookHandler(context, req2);

    console.log(`HTTP Status: ${context.res.status || 200}`);
    console.log(`Response: ${context.res.body || 'OK'}`);

    if (context.res.status === 200 || !context.res.status) {
        console.log('✅ Mensaje 2 devolvió 200 OK (idempotencia correcta)\n');
    } else {
        console.log(`⚠️  WARNING: Mensaje 2 devolvió HTTP ${context.res.status}\n`);
    }

    // Test 3: Nuevo mensaje diferente
    const messageId2 = `wamid.TEST_${Date.now()}_2`;
    console.log('Test 3: Nuevo mensaje diferente...');
    console.log(`   Message ID: ${messageId2}`);
    console.log('----------------------------------------');
    const req3 = createMockRequest(messageId2, testPhone, 'Ahora el congelador tampoco funciona');

    context.res = {};
    await webhookHandler(context, req3);

    console.log(`HTTP Status: ${context.res.status || 200}`);
    console.log(`Response: ${context.res.body || 'OK'}`);

    if (context.res.status === 200 || !context.res.status) {
        console.log('✅ Mensaje 3 procesado correctamente\n');
    } else {
        console.log(`❌ ERROR: Mensaje 3 falló (HTTP ${context.res.status})\n`);
    }

    console.log('==========================================');
    console.log('RESUMEN');
    console.log('==========================================\n');
    console.log('Revisa los logs arriba para verificar:');
    console.log('  - Deduplicación: "Mensaje duplicado detectado (MERGE)"');
    console.log('  - Optimistic Locking: Version incrementa correctamente');
    console.log('  - Timeouts: Respuestas <5s');
    console.log('  - Circuit Breaker: Estado CLOSED\n');
}

runTests().catch(err => {
    console.error('❌ Error en tests:', err);
    process.exit(1);
});
