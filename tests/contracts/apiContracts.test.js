/**
 * API Contract Tests
 * Pruebas de contratos de API para asegurar respuestas correctas
 */

const { z } = require('zod');

// Schemas de validacion para respuestas de API

/**
 * Schema para /api/health
 */
const healthResponseSchema = z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    timestamp: z.string().optional(),
    version: z.string().optional(),
    environment: z.string().optional(),
    responseTimeMs: z.number().optional(),
    checks: z.object({
        database: z.object({
            status: z.enum(['healthy', 'unhealthy', 'unknown']),
            responseTimeMs: z.number().optional()
        }).passthrough().optional(),
        configuration: z.object({
            status: z.enum(['healthy', 'unhealthy']),
            servicesConfigured: z.boolean().optional()
        }).passthrough().optional(),
        memory: z.object({
            status: z.enum(['healthy', 'warning', 'critical']),
            heapUsedMB: z.number().optional(),
            heapTotalMB: z.number().optional(),
            heapPercentage: z.number().optional()
        }).passthrough().optional(),
        uptime: z.object({
            status: z.enum(['healthy', 'warning']),
            uptimeSeconds: z.number().optional()
        }).passthrough().optional(),
        circuitBreakers: z.object({
            status: z.enum(['healthy', 'degraded', 'unhealthy']),
            services: z.record(z.object({
                status: z.enum(['closed', 'open', 'half-open']),
                provider: z.string().optional(),
                enabled: z.boolean().optional()
            }).passthrough()).optional()
        }).passthrough().optional(),
        deadLetter: z.object({
            status: z.enum(['healthy', 'warning', 'critical']),
            total: z.number().optional(),
            pending: z.number().optional(),
            failed: z.number().optional(),
            message: z.string().optional()
        }).passthrough().optional(),
        externalServices: z.object({
            status: z.enum(['healthy', 'degraded', 'unhealthy']),
            services: z.record(z.object({
                configured: z.boolean(),
                provider: z.string().optional()
            }).passthrough()).optional()
        }).passthrough().optional()
    }).passthrough().optional()
}).passthrough();

/**
 * Schema para /api/admin-cache (stats)
 */
const cacheStatsSchema = z.object({
    success: z.boolean(),
    operation: z.literal('stats'),
    stats: z.object({
        equipos: z.object({
            size: z.number(),
            hits: z.number(),
            misses: z.number()
        }).optional(),
        sesiones: z.object({
            size: z.number(),
            hits: z.number(),
            misses: z.number()
        }).optional(),
        reportes: z.object({
            size: z.number(),
            hits: z.number(),
            misses: z.number()
        }).optional()
    }).optional(),
    timestamp: z.string().optional()
});

/**
 * Schema para /api/ticket-resolve
 */
const ticketResolveResponseSchema = z.object({
    success: z.boolean(),
    ticketId: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    previousState: z.string().optional(),
    newState: z.string().optional()
});

/**
 * Schema para errores de API
 */
const apiErrorSchema = z.object({
    error: z.string(),
    message: z.string().optional(),
    code: z.string().optional(),
    timestamp: z.string().optional()
});

/**
 * Schema para respuesta de webhook (200 OK)
 */
const webhookSuccessSchema = z.object({
    status: z.literal('ok').optional()
}).or(z.literal('ok'));

describe('API Contracts', () => {
    describe('Health API Contract', () => {
        const _validHealthyResponse = {
            status: 'healthy',
            timestamp: '2026-01-27T10:30:00.000Z',
            version: '2.0.0',
            environment: 'production',
            responseTimeMs: 45,
            checks: {
                database: { status: 'healthy', responseTimeMs: 23 },
                configuration: { status: 'healthy', servicesConfigured: true },
                memory: { status: 'healthy', heapUsedMB: 45, heapTotalMB: 128, heapPercentage: 35 },
                uptime: { status: 'healthy', uptimeSeconds: 3600 },
                circuitBreakers: {
                    status: 'healthy',
                    services: {
                        ai: { status: 'closed', provider: 'gemini', enabled: true },
                        whatsapp: { status: 'closed' }
                    }
                },
                deadLetter: { status: 'healthy', total: 5, pending: 3, failed: 2, message: 'OK' },
                externalServices: {
                    status: 'healthy',
                    services: {
                        ai: { configured: true, provider: 'gemini' },
                        vision: { configured: true },
                        whatsapp: { configured: true }
                    }
                }
            }
        };

        test('debe validar respuesta con status healthy', () => {
            const result = healthResponseSchema.safeParse({ status: 'healthy' });
            expect(result.success).toBe(true);
        });

        test('debe validar respuesta con status degraded', () => {
            const result = healthResponseSchema.safeParse({ status: 'degraded' });
            expect(result.success).toBe(true);
        });

        test('debe validar respuesta con status unhealthy', () => {
            const result = healthResponseSchema.safeParse({ status: 'unhealthy' });
            expect(result.success).toBe(true);
        });

        test('debe rechazar status invalido', () => {
            const invalidResponse = { status: 'invalid_status' };
            const result = healthResponseSchema.safeParse(invalidResponse);
            expect(result.success).toBe(false);
        });

        test('debe rechazar respuesta sin status', () => {
            const noStatusResponse = { checks: {} };
            const result = healthResponseSchema.safeParse(noStatusResponse);
            expect(result.success).toBe(false);
        });
    });

    describe('Cache Stats Contract', () => {
        test('debe validar respuesta de stats completa', () => {
            const statsResponse = {
                success: true,
                operation: 'stats',
                stats: {
                    equipos: { size: 100, hits: 500, misses: 50 },
                    sesiones: { size: 25, hits: 200, misses: 30 },
                    reportes: { size: 10, hits: 50, misses: 5 }
                },
                timestamp: '2026-01-27T10:30:00.000Z'
            };
            const result = cacheStatsSchema.safeParse(statsResponse);
            expect(result.success).toBe(true);
        });

        test('debe validar respuesta de stats minima', () => {
            const minimalStats = {
                success: true,
                operation: 'stats'
            };
            const result = cacheStatsSchema.safeParse(minimalStats);
            expect(result.success).toBe(true);
        });
    });

    describe('Ticket Resolve Contract', () => {
        test('debe validar respuesta exitosa', () => {
            const successResponse = {
                success: true,
                ticketId: 'TKT1706300001',
                message: 'Ticket resuelto exitosamente',
                previousState: 'PENDIENTE',
                newState: 'RESUELTO'
            };
            const result = ticketResolveResponseSchema.safeParse(successResponse);
            expect(result.success).toBe(true);
        });

        test('debe validar respuesta de error', () => {
            const errorResponse = {
                success: false,
                error: 'Ticket no encontrado',
                ticketId: 'TKT9999999999'
            };
            const result = ticketResolveResponseSchema.safeParse(errorResponse);
            expect(result.success).toBe(true);
        });
    });

    describe('API Error Contract', () => {
        test('debe validar error con mensaje', () => {
            const errorResponse = {
                error: 'Bad Request',
                message: 'El campo ticketId es requerido',
                code: 'VALIDATION_ERROR'
            };
            const result = apiErrorSchema.safeParse(errorResponse);
            expect(result.success).toBe(true);
        });

        test('debe validar error minimo', () => {
            const minimalError = { error: 'Internal Server Error' };
            const result = apiErrorSchema.safeParse(minimalError);
            expect(result.success).toBe(true);
        });
    });

    describe('Webhook Response Contract', () => {
        test('debe validar respuesta de string ok', () => {
            const result = webhookSuccessSchema.safeParse('ok');
            expect(result.success).toBe(true);
        });

        test('debe validar respuesta de objeto con status ok', () => {
            const result = webhookSuccessSchema.safeParse({ status: 'ok' });
            expect(result.success).toBe(true);
        });
    });
});

describe('Request Payload Contracts', () => {
    /**
     * Schema para payload de webhook WhatsApp
     */
    const whatsappWebhookPayloadSchema = z.object({
        object: z.literal('whatsapp_business_account'),
        entry: z.array(z.object({
            id: z.string(),
            changes: z.array(z.object({
                value: z.object({
                    messaging_product: z.literal('whatsapp').optional(),
                    metadata: z.object({
                        display_phone_number: z.string().optional(),
                        phone_number_id: z.string().optional()
                    }).optional(),
                    contacts: z.array(z.object({
                        profile: z.object({ name: z.string() }).optional(),
                        wa_id: z.string()
                    })).optional(),
                    messages: z.array(z.object({
                        from: z.string(),
                        id: z.string(),
                        timestamp: z.string(),
                        type: z.enum(['text', 'image', 'interactive', 'location', 'document', 'audio', 'video']),
                        text: z.object({ body: z.string() }).optional(),
                        image: z.object({
                            id: z.string(),
                            mime_type: z.string().optional()
                        }).optional(),
                        interactive: z.object({
                            type: z.string(),
                            button_reply: z.object({
                                id: z.string(),
                                title: z.string()
                            }).optional(),
                            list_reply: z.object({
                                id: z.string(),
                                title: z.string()
                            }).optional()
                        }).optional(),
                        location: z.object({
                            latitude: z.number(),
                            longitude: z.number()
                        }).optional()
                    })).optional(),
                    statuses: z.array(z.object({
                        id: z.string(),
                        status: z.enum(['sent', 'delivered', 'read', 'failed']),
                        timestamp: z.string(),
                        recipient_id: z.string()
                    })).optional()
                }),
                field: z.literal('messages')
            }))
        }))
    });

    /**
     * Schema para ticket resolve request
     */
    const ticketResolveRequestSchema = z.object({
        ticketId: z.string().regex(/^TKT\d+$/, 'ticketId debe seguir formato TKT seguido de numeros')
    });

    describe('WhatsApp Webhook Payload', () => {
        test('debe validar payload de mensaje de texto', () => {
            const textPayload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: '123456789',
                    changes: [{
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: {
                                display_phone_number: '15551234567',
                                phone_number_id: '123456789'
                            },
                            contacts: [{ profile: { name: 'Test User' }, wa_id: '5215512345678' }],
                            messages: [{
                                from: '5215512345678',
                                id: 'wamid.123',
                                timestamp: '1706350000',
                                type: 'text',
                                text: { body: 'Hola' }
                            }]
                        },
                        field: 'messages'
                    }]
                }]
            };
            const result = whatsappWebhookPayloadSchema.safeParse(textPayload);
            expect(result.success).toBe(true);
        });

        test('debe validar payload de boton', () => {
            const buttonPayload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: '123456789',
                    changes: [{
                        value: {
                            messages: [{
                                from: '5215512345678',
                                id: 'wamid.456',
                                timestamp: '1706350001',
                                type: 'interactive',
                                interactive: {
                                    type: 'button_reply',
                                    button_reply: { id: 'btn_refrigerador', title: 'Refrigerador' }
                                }
                            }]
                        },
                        field: 'messages'
                    }]
                }]
            };
            const result = whatsappWebhookPayloadSchema.safeParse(buttonPayload);
            expect(result.success).toBe(true);
        });

        test('debe validar payload de imagen', () => {
            const imagePayload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: '123456789',
                    changes: [{
                        value: {
                            messages: [{
                                from: '5215512345678',
                                id: 'wamid.789',
                                timestamp: '1706350002',
                                type: 'image',
                                image: { id: 'media_123', mime_type: 'image/jpeg' }
                            }]
                        },
                        field: 'messages'
                    }]
                }]
            };
            const result = whatsappWebhookPayloadSchema.safeParse(imagePayload);
            expect(result.success).toBe(true);
        });

        test('debe validar payload de status update', () => {
            const statusPayload = {
                object: 'whatsapp_business_account',
                entry: [{
                    id: '123456789',
                    changes: [{
                        value: {
                            statuses: [{
                                id: 'wamid.123',
                                status: 'read',
                                timestamp: '1706350003',
                                recipient_id: '5215512345678'
                            }]
                        },
                        field: 'messages'
                    }]
                }]
            };
            const result = whatsappWebhookPayloadSchema.safeParse(statusPayload);
            expect(result.success).toBe(true);
        });
    });

    describe('Ticket Resolve Request', () => {
        test('debe validar ticketId valido', () => {
            const result = ticketResolveRequestSchema.safeParse({ ticketId: 'TKT1706300001' });
            expect(result.success).toBe(true);
        });

        test('debe rechazar ticketId sin prefijo TKT', () => {
            const result = ticketResolveRequestSchema.safeParse({ ticketId: '1706300001' });
            expect(result.success).toBe(false);
        });

        test('debe rechazar ticketId vacio', () => {
            const result = ticketResolveRequestSchema.safeParse({ ticketId: '' });
            expect(result.success).toBe(false);
        });

        test('debe rechazar sin ticketId', () => {
            const result = ticketResolveRequestSchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });
});
