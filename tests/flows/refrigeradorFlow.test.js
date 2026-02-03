/**
 * Tests - Flujo de Refrigerador (E2E)
 * Pruebas completas del flujo de conversación para reportes de refrigerador
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/ai/intentService', () => ({
    detectIntent: jest.fn()
}));

jest.mock('../../core/services/infrastructure/metricsService', () => ({
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn()
}));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    recordRequest: jest.fn(),
    isSpamming: jest.fn().mockReturnValue(false)
}));

const messageHandler = require('../../bot/controllers/messageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const intentService = require('../../core/services/ai/intentService');

describe('Flujo Completo - Refrigerador', () => {
    const telefono = '+5215512345678';
    let mockContext;

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn()
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();

        // Setup intentService default mock
        intentService.detectIntent.mockResolvedValue({
            intencion: 'OTRO',
            confianza: 0.5,
            metodo: 'mock',
            datos_extraidos: {}
        });
    });

    describe('Flujo Exitoso Completo', () => {
        test('debe completar flujo: Saludo → Selección → SAP → Confirmación → Descripción → Ticket', async () => {
            // PASO 1: Usuario envía saludo
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'hola', 'msg_1', mockContext);

            // Verificar: Se mostró bienvenida con opciones
            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalledWith(
                telefono,
                expect.any(String),
                expect.any(String),
                expect.arrayContaining([
                    expect.objectContaining({ id: 'btn_tipo_refrigerador' })
                ])
            );

            // PASO 2: Usuario presiona botón de refrigerador
            whatsapp.__reset();
            await messageHandler.handleButton(telefono, 'btn_tipo_refrigerador', 'msg_2', mockContext);

            // Verificar: Se pidió el SAP
            const messages = whatsapp.__getAllMessages();
            const sapRequest = messages.find(m =>
                m.bodyText?.includes('SAP') || m.text?.includes('SAP')
            );
            expect(sapRequest).toBeDefined();

            // PASO 3: Usuario ingresa código SAP
            whatsapp.__reset();
            const session = await db.getSession(telefono);
            db.__setSession(telefono, { ...session, Estado: 'REFRI_ESPERA_SAP' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, '1234567', 'msg_3', mockContext);

            // Verificar: Se mostró información del equipo con opciones de confirmación
            const messagesAfterSAP = whatsapp.__getAllMessages();
            const confirmRequest = messagesAfterSAP.find(m =>
                m.buttons?.some(b => b.id === 'btn_confirmar_equipo')
            );
            expect(confirmRequest).toBeDefined();

            // PASO 4: Usuario confirma el equipo
            whatsapp.__reset();
            const sessionAfterSAP = db.__getSession(telefono);
            db.__setSession(telefono, { ...sessionAfterSAP, Estado: 'REFRI_CONFIRMAR_EQUIPO', EquipoIdTemp: 1 });

            await messageHandler.handleButton(telefono, 'btn_confirmar_equipo', 'msg_4', mockContext);

            // Verificar: Se pidió descripción del problema
            const messagesAfterConfirm = whatsapp.__getAllMessages();
            const descRequest = messagesAfterConfirm.find(m =>
                m.text?.includes('problema') || m.bodyText?.includes('problema')
            );
            expect(descRequest).toBeDefined();

            // PASO 5: Usuario describe el problema
            whatsapp.__reset();
            const sessionAfterConfirm = db.__getSession(telefono);
            db.__setSession(telefono, {
                ...sessionAfterConfirm,
                Estado: 'REFRI_ESPERA_DESCRIPCION',
                EquipoIdTemp: 1,
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' })
            });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'No enfría correctamente', 'msg_5', mockContext);

            // Verificar: Se creó el ticket
            expect(db.createReporte).toHaveBeenCalled();

            // Verificar: Se envió mensaje con número de ticket
            const finalMessages = whatsapp.__getAllMessages();
            const ticketMessage = finalMessages.find(m =>
                m.text?.includes('TKT') || m.text?.includes('Ticket')
            );
            expect(ticketMessage).toBeDefined();
        });
    });

    describe('Flujo con Corrección de SAP', () => {
        test('debe permitir corregir SAP si el usuario selecciona "No, corregir"', async () => {
            // Setup: Usuario ya confirmó tipo y está en confirmación de equipo
            db.__setSession(telefono, {
                Estado: 'REFRI_CONFIRMAR_EQUIPO',
                EquipoIdTemp: 1,
                DatosTemp: JSON.stringify({})
            });

            // Usuario presiona "No, corregir"
            await messageHandler.handleButton(telefono, 'btn_corregir_equipo', 'msg_1', mockContext);

            // Verificar: Se pidió SAP nuevamente
            const messages = whatsapp.__getAllMessages();
            const sapRequest = messages.find(m =>
                m.text?.includes('SAP') || m.bodyText?.includes('SAP')
            );
            expect(sapRequest).toBeDefined();

            // Verificar: Estado cambió a ESPERA_SAP
            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'REFRI_ESPERA_SAP',
                expect.any(Object),
                null,
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Flujo con SAP Inválido', () => {
        test('debe rechazar SAP con formato inválido', async () => {
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            // Usuario ingresa SAP inválido (muy corto)
            await messageHandler.handleText(telefono, '123', 'msg_1', mockContext);

            // Verificar: Se envió mensaje de error
            const messages = whatsapp.__getAllMessages();
            const errorMessage = messages.find(m =>
                m.text?.includes('inválido') || m.text?.includes('Código')
            );
            expect(errorMessage).toBeDefined();
        });

        test('debe manejar SAP no encontrado en BD', async () => {
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });

            // SAP no existe en BD
            db.getEquipoBySAP.mockResolvedValueOnce(null);

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, '9999999', 'msg_1', mockContext);

            // Verificar: Se envió mensaje de no encontrado
            const messages = whatsapp.__getAllMessages();
            const notFoundMessage = messages.find(m =>
                m.text?.includes('No encontré') || m.text?.includes('no existe')
            );
            expect(notFoundMessage).toBeDefined();
        });
    });

    describe('Flujo con Cancelación', () => {
        test('debe cancelar flujo cuando usuario dice "cancelar"', async () => {
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'CANCELAR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'cancelar', 'msg_1', mockContext);

            // Verificar: Se envió mensaje de cancelación
            const messages = whatsapp.__getAllMessages();
            const cancelMessage = messages.find(m =>
                m.text?.includes('cancelado') || m.text?.includes('Cancelado')
            );
            expect(cancelMessage).toBeDefined();

            // Verificar: Sesión cambió a CANCELADO
            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'CANCELADO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });

        test('debe cancelar flujo con botón cancelar', async () => {
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_DESCRIPCION' });

            await messageHandler.handleButton(telefono, 'btn_cancelar', 'msg_1', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'CANCELADO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Flujo Inteligente - Extracción de Datos', () => {
        test('debe extraer tipo de equipo y problema de mensaje largo', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'REPORTAR_FALLA',
                confianza: 0.85,
                metodo: 'ai_extract',
                tipo_equipo: 'REFRIGERADOR',
                problema: 'No enfría',
                datos_extraidos: {
                    tipo_equipo: 'REFRIGERADOR',
                    problema: 'No enfría'
                }
            });

            await messageHandler.handleText(
                telefono,
                'Hola, tengo un refrigerador que no enfría bien',
                'msg_1',
                mockContext
            );

            // Verificar: Se inició flujo de refrigerador directamente
            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                expect.stringContaining('REFRI'),
                expect.objectContaining({
                    tipoReporte: 'REFRIGERADOR'
                }),
                expect.any(Object),
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Flujo con Texto Ambiguo', () => {
        test('debe pedir confirmación para confianza baja', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'TIPO_REFRIGERADOR',
                confianza: 0.6, // Baja confianza
                metodo: 'ai_interpret',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'enfriador', 'msg_1', mockContext);

            // Verificar: Se pidió confirmación
            const messages = whatsapp.__getAllMessages();
            const confirmMessage = messages.find(m =>
                m.buttons?.some(b => b.id === 'btn_tipo_refrigerador')
            );
            expect(confirmMessage).toBeDefined();
        });
    });
});
