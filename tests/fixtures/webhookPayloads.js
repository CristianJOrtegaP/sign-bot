/**
 * AC FIXBOT - Fixtures de Payloads de WhatsApp
 * Datos de prueba reutilizables para tests
 */

// Payload de mensaje de texto basico
const textMessagePayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '123456789',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '5215512345678',
                    phone_number_id: 'PHONE_ID'
                },
                contacts: [{
                    profile: { name: 'Usuario Test' },
                    wa_id: '5215512345678'
                }],
                messages: [{
                    from: '5215512345678',
                    id: 'wamid.test123',
                    timestamp: '1704067200',
                    type: 'text',
                    text: { body: 'Hola' }
                }]
            },
            field: 'messages'
        }]
    }]
};

// Payload de respuesta a boton
const buttonReplyPayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '123456789',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '5215512345678',
                    phone_number_id: 'PHONE_ID'
                },
                messages: [{
                    from: '5215512345678',
                    id: 'wamid.btn123',
                    timestamp: '1704067200',
                    type: 'interactive',
                    interactive: {
                        type: 'button_reply',
                        button_reply: {
                            id: 'btn_confirm',
                            title: 'Confirmar'
                        }
                    }
                }]
            },
            field: 'messages'
        }]
    }]
};

// Payload de imagen
const imageMessagePayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '123456789',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '5215512345678',
                    phone_number_id: 'PHONE_ID'
                },
                messages: [{
                    from: '5215512345678',
                    id: 'wamid.img123',
                    timestamp: '1704067200',
                    type: 'image',
                    image: {
                        id: 'IMAGE_ID_123',
                        mime_type: 'image/jpeg',
                        sha256: 'abc123'
                    }
                }]
            },
            field: 'messages'
        }]
    }]
};

// Payload de ubicacion
const locationMessagePayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '123456789',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '5215512345678',
                    phone_number_id: 'PHONE_ID'
                },
                messages: [{
                    from: '5215512345678',
                    id: 'wamid.loc123',
                    timestamp: '1704067200',
                    type: 'location',
                    location: {
                        latitude: 19.4326,
                        longitude: -99.1332,
                        name: 'Ciudad de Mexico',
                        address: 'Centro Historico'
                    }
                }]
            },
            field: 'messages'
        }]
    }]
};

// Payload de notificacion de estado (no es mensaje)
const statusNotificationPayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '123456789',
        changes: [{
            value: {
                messaging_product: 'whatsapp',
                metadata: {
                    display_phone_number: '5215512345678',
                    phone_number_id: 'PHONE_ID'
                },
                statuses: [{
                    id: 'wamid.status123',
                    status: 'delivered',
                    timestamp: '1704067200'
                }]
            },
            field: 'messages'
        }]
    }]
};

/**
 * Crea un payload de mensaje de texto personalizado
 * @param {Object} options - Opciones de personalizacion
 * @returns {Object} - Payload personalizado
 */
function createTextMessagePayload(options = {}) {
    const {
        from = '5215512345678',
        messageId = `wamid.test${  Date.now()}`,
        text = 'Hola'
    } = options;

    return {
        ...textMessagePayload,
        entry: [{
            ...textMessagePayload.entry[0],
            changes: [{
                ...textMessagePayload.entry[0].changes[0],
                value: {
                    ...textMessagePayload.entry[0].changes[0].value,
                    messages: [{
                        from,
                        id: messageId,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: 'text',
                        text: { body: text }
                    }]
                }
            }]
        }]
    };
}

/**
 * Crea un payload de boton personalizado
 * @param {Object} options - Opciones de personalizacion
 * @returns {Object} - Payload personalizado
 */
function createButtonReplyPayload(options = {}) {
    const {
        from = '5215512345678',
        messageId = `wamid.btn${  Date.now()}`,
        buttonId = 'btn_confirm',
        buttonTitle = 'Confirmar'
    } = options;

    return {
        ...buttonReplyPayload,
        entry: [{
            ...buttonReplyPayload.entry[0],
            changes: [{
                ...buttonReplyPayload.entry[0].changes[0],
                value: {
                    ...buttonReplyPayload.entry[0].changes[0].value,
                    messages: [{
                        from,
                        id: messageId,
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
                }
            }]
        }]
    };
}

module.exports = {
    textMessagePayload,
    buttonReplyPayload,
    imageMessagePayload,
    locationMessagePayload,
    statusNotificationPayload,
    createTextMessagePayload,
    createButtonReplyPayload
};
