/**
 * Tests - Escenarios de Conversación Integrados
 * Pruebas de escenarios reales de uso con múltiples turnos de conversación
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

describe('Escenarios de Conversación', () => {
    const telefono = '+5215512345678';
    let mockContext;
    let messageCounter = 1;

    // Helper para simular envío de mensaje
    const sendMessage = async (text) => {
        whatsapp.__reset();
        const msgId = `msg_${messageCounter++}`;
        await messageHandler.handleText(telefono, text, msgId, mockContext);
        return whatsapp.__getAllMessages();
    };

    // Helper para simular presión de botón
    const pressButton = async (buttonId) => {
        whatsapp.__reset();
        const msgId = `msg_${messageCounter++}`;
        await messageHandler.handleButton(telefono, buttonId, msgId, mockContext);
        return whatsapp.__getAllMessages();
    };

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();
        messageCounter = 1;

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn()
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();

        intentService.detectIntent.mockResolvedValue({
            intencion: 'OTRO',
            confianza: 0.5,
            metodo: 'mock',
            datos_extraidos: {}
        });
    });

    describe('Escenario: Usuario nuevo con flujo completo de refrigerador', () => {
        test('conversación natural completa', async () => {
            // Usuario: "Hola"
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            let messages = await sendMessage('Hola');
            expect(messages.some(m => m.buttons)).toBe(true);

            // Usuario presiona: Refrigerador
            messages = await pressButton('btn_tipo_refrigerador');
            expect(messages.some(m => m.text?.includes('SAP') || m.bodyText?.includes('SAP'))).toBe(true);

            // Usuario: "1234567" (SAP)
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });
            messages = await sendMessage('1234567');
            expect(messages.some(m => m.buttons?.some(b => b.id === 'btn_confirmar_equipo'))).toBe(true);

            // Usuario presiona: Confirmar
            db.__setSession(telefono, { Estado: 'REFRI_CONFIRMAR_EQUIPO', EquipoIdTemp: 1 });
            messages = await pressButton('btn_confirmar_equipo');
            expect(messages.some(m => m.text?.includes('problema') || m.bodyText?.includes('problema'))).toBe(true);

            // Usuario: "No enfría"
            db.__setSession(telefono, {
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
            messages = await sendMessage('No enfría');
            expect(messages.some(m => m.text?.includes('TKT') || m.text?.includes('Ticket'))).toBe(true);
        });
    });

    describe('Escenario: Usuario que cambia de opinión', () => {
        test('cancelación mid-flow y reinicio', async () => {
            // Usuario inicia flujo de refrigerador
            await pressButton('btn_tipo_refrigerador');

            // Usuario decide cancelar
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'CANCELAR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            let messages = await sendMessage('cancelar');
            expect(messages.some(m => m.text?.includes('cancelado'))).toBe(true);

            // Usuario reinicia con vehículo
            db.__setSession(telefono, { Estado: 'INICIO' });
            messages = await pressButton('btn_tipo_vehiculo');
            expect(messages.some(m => m.text?.includes('Empleado') || m.bodyText?.includes('Empleado'))).toBe(true);
        });
    });

    describe('Escenario: Usuario con mensaje largo descriptivo', () => {
        test('debe extraer datos y saltar pasos', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'REPORTAR_FALLA',
                confianza: 0.85,
                metodo: 'regex+ai_extract_all',
                tipo_equipo: 'REFRIGERADOR',
                problema: 'No enfría',
                codigo_sap: '1234567',
                datos_extraidos: {
                    tipo_equipo: 'REFRIGERADOR',
                    problema: 'No enfría',
                    codigo_sap: '1234567'
                }
            });

            const _messages = await sendMessage(
                'Hola, el refrigerador con código 1234567 no enfría bien desde ayer'
            );

            // Debería haber avanzado directamente a confirmación con equipo encontrado
            expect(db.updateSession).toHaveBeenCalled();
        });
    });

    describe('Escenario: Usuario con errores y correcciones', () => {
        test('múltiples intentos de SAP hasta el correcto', async () => {
            // Inicio de flujo
            await pressButton('btn_tipo_refrigerador');

            // Primer intento: SAP inválido (muy corto)
            db.__setSession(telefono, { Estado: 'REFRI_ESPERA_SAP' });
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });
            let messages = await sendMessage('123');
            expect(messages.some(m => m.text?.includes('inválido'))).toBe(true);

            // Segundo intento: SAP no existe
            db.getEquipoBySAP.mockResolvedValueOnce(null);
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });
            messages = await sendMessage('9999999');
            expect(messages.some(m => m.text?.includes('No encontré') || m.text?.includes('no existe'))).toBe(true);

            // Tercer intento: SAP correcto
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });
            messages = await sendMessage('1234567');
            expect(messages.some(m => m.buttons?.some(b => b.id === 'btn_confirmar_equipo'))).toBe(true);
        });
    });

    describe('Escenario: Múltiples usuarios simultáneos', () => {
        test('sesiones independientes para diferentes usuarios', async () => {
            const telefono1 = '+5215511111111';
            const telefono2 = '+5215522222222';

            // Usuario 1 inicia flujo de refrigerador
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'TIPO_REFRIGERADOR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            await messageHandler.handleText(telefono1, 'refrigerador', 'msg_1', mockContext);

            // Usuario 2 inicia flujo de vehículo
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'TIPO_VEHICULO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            await messageHandler.handleText(telefono2, 'vehiculo', 'msg_2', mockContext);

            // Verificar que cada usuario tiene su propia sesión
            expect(db.getSession).toHaveBeenCalledWith(telefono1);
            expect(db.getSession).toHaveBeenCalledWith(telefono2);
        });
    });

    describe('Escenario: Reactivación de sesión expirada', () => {
        test('sesión en TIMEOUT se reactiva con nuevo mensaje', async () => {
            db.__setSession(telefono, { Estado: 'TIMEOUT' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            const messages = await sendMessage('Hola');

            // Verificar que se reactivó la sesión
            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'INICIO',
                null,
                null,
                expect.any(String),
                expect.stringContaining('reactivada')
            );

            // Y se mostró bienvenida
            expect(messages.some(m => m.buttons)).toBe(true);
        });
    });

    describe('Escenario: Despedida y nuevo inicio', () => {
        test('usuario se despide y luego inicia nuevo reporte', async () => {
            // Usuario se despide
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'DESPEDIDA',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            let messages = await sendMessage('gracias, adiós');
            expect(messages.some(m => m.text?.includes('pronto'))).toBe(true);

            // Después de un tiempo, usuario inicia nuevo reporte
            db.__setSession(telefono, { Estado: 'INICIO' });
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });
            messages = await sendMessage('hola');
            expect(messages.some(m => m.buttons)).toBe(true);
        });
    });
});
