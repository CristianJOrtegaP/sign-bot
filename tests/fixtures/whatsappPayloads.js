/**
 * Test Fixtures - WhatsApp Webhook Payloads
 * Payloads reales de WhatsApp para testing
 */

const PHONE_NUMBER = '5215512345678';
const WHATSAPP_ID = '1234567890';

/**
 * Genera un payload de mensaje de texto
 */
const createTextMessage = (text, from = PHONE_NUMBER, messageId = null) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                },
                contacts: [{
                    profile: { name: 'Test User' },
                    wa_id: from
                }],
                messages: [{
                    from,
                    id: messageId || `wamid.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: text }
                }]
            },
            field: 'messages'
        }]
    }]
});

/**
 * Genera un payload de respuesta de boton
 */
const createButtonResponse = (buttonId, buttonTitle, from = PHONE_NUMBER, messageId = null) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                },
                contacts: [{
                    profile: { name: 'Test User' },
                    wa_id: from
                }],
                messages: [{
                    from,
                    id: messageId || `wamid.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'interactive',
                    interactive: {
                        type: 'button_reply',
                        button_reply: {
                            id: buttonId,
                            title: buttonTitle
                        }
                    }
                }]
            },
            field: 'messages'
        }]
    }]
});

/**
 * Genera un payload de imagen
 */
const createImageMessage = (mediaId, mimeType = 'image/jpeg', from = PHONE_NUMBER, messageId = null) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                },
                contacts: [{
                    profile: { name: 'Test User' },
                    wa_id: from
                }],
                messages: [{
                    from,
                    id: messageId || `wamid.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'image',
                    image: {
                        id: mediaId,
                        mime_type: mimeType,
                        sha256: 'abc123hash'
                    }
                }]
            },
            field: 'messages'
        }]
    }]
});

/**
 * Genera un payload de ubicacion
 */
const createLocationMessage = (latitude, longitude, from = PHONE_NUMBER, messageId = null) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                },
                contacts: [{
                    profile: { name: 'Test User' },
                    wa_id: from
                }],
                messages: [{
                    from,
                    id: messageId || `wamid.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'location',
                    location: {
                        latitude,
                        longitude,
                        name: 'Test Location',
                        address: 'Test Address'
                    }
                }]
            },
            field: 'messages'
        }]
    }]
});

/**
 * Payload de verificacion de webhook
 */
const createVerificationRequest = (verifyToken, challenge = '1234567890') => ({
    'hub.mode': 'subscribe',
    'hub.verify_token': verifyToken,
    'hub.challenge': challenge
});

/**
 * Payload de status update (read receipt)
 */
const createStatusUpdate = (messageId, status = 'read', from = PHONE_NUMBER) => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                },
                statuses: [{
                    id: messageId,
                    status,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: from
                }]
            },
            field: 'messages'
        }]
    }]
});

/**
 * Payload vacio (sin mensajes)
 */
const createEmptyPayload = () => ({
    object: 'whatsapp_business_account',
    entry: [{
        id: WHATSAPP_ID,
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
                }
            },
            field: 'messages'
        }]
    }]
});

/**
 * Payload malformado (para tests de error)
 */
const createMalformedPayloads = () => ({
    missingObject: { entry: [] },
    missingEntry: { object: 'whatsapp_business_account' },
    emptyEntry: { object: 'whatsapp_business_account', entry: [] },
    nullChanges: { object: 'whatsapp_business_account', entry: [{ id: '123', changes: null }] },
    invalidMessageType: {
        object: 'whatsapp_business_account',
        entry: [{
            id: WHATSAPP_ID,
            changes: [{
                value: {
                    messages: [{
                        type: 'unknown_type',
                        from: PHONE_NUMBER
                    }]
                },
                field: 'messages'
            }]
        }]
    }
});

/**
 * Payloads de escenarios comunes
 */
const commonScenarios = {
    // Saludo inicial
    greeting: createTextMessage('Hola'),

    // Seleccion de tipo de equipo
    selectRefrigerador: createButtonResponse('btn_tipo_refrigerador', 'Refrigerador'),
    selectVehiculo: createButtonResponse('btn_tipo_vehiculo', 'Vehiculo'),

    // Codigo SAP
    sapCode: createTextMessage('1234567'),
    invalidSapCode: createTextMessage('123'),

    // Confirmacion
    confirmEquipo: createButtonResponse('btn_confirmar_equipo', 'Si, confirmar'),
    correctEquipo: createButtonResponse('btn_corregir_equipo', 'No, corregir'),

    // Descripcion del problema
    problemDescription: createTextMessage('El refrigerador no enfria bien desde ayer'),

    // Cancelacion
    cancel: createTextMessage('cancelar'),

    // Encuesta
    surveyRating5: createTextMessage('5'),
    surveyRating1: createTextMessage('1'),
    surveyComment: createTextMessage('Excelente servicio, muy rapido'),

    // Consulta de estado
    statusQuery: createTextMessage('cual es el estado de mi reporte?'),

    // Despedida
    goodbye: createTextMessage('gracias, adios')
};

/**
 * Genera secuencia de payloads para flujo completo
 */
const generateFullRefrigeradorFlow = (telefono = PHONE_NUMBER) => [
    { step: 'greeting', payload: createTextMessage('Hola', telefono), expectedState: 'INICIO' },
    { step: 'select_type', payload: createButtonResponse('btn_tipo_refrigerador', 'Refrigerador', telefono), expectedState: 'REFRI_ESPERA_SAP' },
    { step: 'enter_sap', payload: createTextMessage('1234567', telefono), expectedState: 'REFRI_CONFIRMAR_EQUIPO' },
    { step: 'confirm', payload: createButtonResponse('btn_confirmar_equipo', 'Si', telefono), expectedState: 'REFRI_ESPERA_DESCRIPCION' },
    { step: 'describe', payload: createTextMessage('No enfria', telefono), expectedState: 'INICIO' }
];

const generateFullVehiculoFlow = (telefono = PHONE_NUMBER) => [
    { step: 'greeting', payload: createTextMessage('Hola', telefono), expectedState: 'INICIO' },
    { step: 'select_type', payload: createButtonResponse('btn_tipo_vehiculo', 'Vehiculo', telefono), expectedState: 'VEHICULO_ESPERA_EMPLEADO' },
    { step: 'enter_employee', payload: createTextMessage('12345', telefono), expectedState: 'VEHICULO_ESPERA_SAP' },
    { step: 'enter_sap', payload: createTextMessage('ABC1234', telefono), expectedState: 'VEHICULO_ESPERA_DESCRIPCION' },
    { step: 'describe', payload: createTextMessage('No arranca', telefono), expectedState: 'INICIO' }
];

module.exports = {
    // Constantes
    PHONE_NUMBER,
    WHATSAPP_ID,

    // Generadores
    createTextMessage,
    createButtonResponse,
    createImageMessage,
    createLocationMessage,
    createVerificationRequest,
    createStatusUpdate,
    createEmptyPayload,
    createMalformedPayloads,

    // Escenarios predefinidos
    commonScenarios,

    // Flujos completos
    generateFullRefrigeradorFlow,
    generateFullVehiculoFlow
};
