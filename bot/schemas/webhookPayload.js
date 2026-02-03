/**
 * AC FIXBOT - Schema de Validacion para Webhook de WhatsApp
 */

const { z } = require('zod');

// Schema para mensaje de texto
const textMessageSchema = z.object({
    body: z.string()
});

// Schema para mensaje de imagen
const imageMessageSchema = z.object({
    id: z.string(),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    caption: z.string().optional()
});

// Schema para respuesta de boton
const buttonReplySchema = z.object({
    id: z.string(),
    title: z.string().optional()
});

// Schema para mensaje interactivo
const interactiveMessageSchema = z.object({
    type: z.enum(['button_reply', 'list_reply']),
    button_reply: buttonReplySchema.optional(),
    list_reply: z.object({
        id: z.string(),
        title: z.string().optional()
    }).optional()
});

// Schema para ubicacion
const locationSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional()
});

// Schema para mensaje individual
const messageSchema = z.object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.enum(['text', 'image', 'interactive', 'location', 'audio', 'video', 'document', 'sticker', 'contacts', 'reaction']),
    text: textMessageSchema.optional(),
    image: imageMessageSchema.optional(),
    interactive: interactiveMessageSchema.optional(),
    location: locationSchema.optional()
});

// Schema para value del webhook
const webhookValueSchema = z.object({
    messaging_product: z.literal('whatsapp'),
    metadata: z.object({
        display_phone_number: z.string(),
        phone_number_id: z.string()
    }),
    contacts: z.array(z.object({
        profile: z.object({
            name: z.string()
        }),
        wa_id: z.string()
    })).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(z.any()).optional()
});

// Schema completo del webhook de WhatsApp
const webhookPayloadSchema = z.object({
    object: z.literal('whatsapp_business_account'),
    entry: z.array(z.object({
        id: z.string(),
        changes: z.array(z.object({
            value: webhookValueSchema,
            field: z.literal('messages')
        }))
    }))
});

/**
 * Valida un payload de webhook de WhatsApp
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateWebhookPayload(payload) {
    try {
        const result = webhookPayloadSchema.parse(payload);
        return { success: true, data: result };
    } catch (error) {
        return {
            success: false,
            error: error.errors?.map(e => e.message).join(', ') || 'Invalid payload'
        };
    }
}

/**
 * Extrae el mensaje del payload de webhook
 * @param {Object} payload - Payload del webhook
 * @returns {Object|null} - Mensaje extraido o null
 */
function extractMessage(payload) {
    try {
        const entry = payload.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];
        return message || null;
    } catch {
        return null;
    }
}

module.exports = {
    webhookPayloadSchema,
    messageSchema,
    textMessageSchema,
    imageMessageSchema,
    interactiveMessageSchema,
    locationSchema,
    validateWebhookPayload,
    extractMessage
};
