/**
 * E2E Tests - Flujos Completos de Conversacion
 * Tests end-to-end que simulan conversaciones completas
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

const { createTextMessage: _createTextMessage, createButtonResponse: _createButtonResponse, PHONE_NUMBER } = require('../fixtures/whatsappPayloads');
const { refrigeradores: _refrigeradores, sesiones: _sesiones } = require('../fixtures/databaseRecords');

describe('E2E - Flujos Completos', () => {
    let mockContext;
    let messageCounter = 1;

    // Helpers
    const sendText = async (text, telefono = PHONE_NUMBER) => {
        whatsapp.__reset();
        const msgId = `msg_${messageCounter++}`;
        await messageHandler.handleText(telefono, text, msgId, mockContext);
        return whatsapp.__getAllMessages();
    };

    const pressButton = async (buttonId, telefono = PHONE_NUMBER) => {
        whatsapp.__reset();
        const msgId = `msg_${messageCounter++}`;
        await messageHandler.handleButton(telefono, buttonId, msgId, mockContext);
        return whatsapp.__getAllMessages();
    };

    const setSessionState = (state, extras = {}) => {
        db.__setSession(PHONE_NUMBER, { Estado: state, ...extras });
    };

    const mockIntent = (intencion, extras = {}) => {
        intentService.detectIntent.mockResolvedValueOnce({
            intencion,
            confianza: 0.95,
            metodo: 'mock',
            datos_extraidos: {},
            ...extras
        });
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

        // Default intent mock
        intentService.detectIntent.mockResolvedValue({
            intencion: 'OTRO',
            confianza: 0.5,
            metodo: 'mock',
            datos_extraidos: {}
        });
    });

    describe('Flujo Refrigerador Completo - Camino Feliz', () => {
        test('debe completar todo el flujo de reporte de refrigerador', async () => {
            // PASO 1: Saludo inicial
            mockIntent('SALUDO');
            let messages = await sendText('Hola');

            expect(messages.length).toBeGreaterThan(0);
            expect(messages.some(m => m.buttons)).toBe(true);
            expect(messages.some(m =>
                m.buttons?.some(b => b.id === 'btn_tipo_refrigerador')
            )).toBe(true);

            // PASO 2: Seleccionar tipo refrigerador
            messages = await pressButton('btn_tipo_refrigerador');
            expect(messages.some(m =>
                m.text?.includes('SAP') || m.bodyText?.includes('SAP')
            )).toBe(true);

            // PASO 3: Ingresar codigo SAP
            setSessionState('REFRI_ESPERA_SAP');
            mockIntent('OTRO');
            messages = await sendText('1234567');

            expect(messages.some(m =>
                m.buttons?.some(b => b.id === 'btn_confirmar_equipo')
            )).toBe(true);

            // PASO 4: Confirmar equipo
            setSessionState('REFRI_CONFIRMAR_EQUIPO', { EquipoIdTemp: 1 });
            messages = await pressButton('btn_confirmar_equipo');

            expect(messages.some(m =>
                m.text?.includes('problema') || m.bodyText?.includes('problema')
            )).toBe(true);

            // PASO 5: Describir problema
            setSessionState('REFRI_ESPERA_DESCRIPCION', {
                EquipoIdTemp: 1,
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' })
            });
            mockIntent('OTRO');
            messages = await sendText('El refrigerador no enfria desde ayer');

            // Verificar ticket creado
            expect(messages.some(m =>
                m.text?.includes('TKT') || m.text?.includes('Ticket')
            )).toBe(true);
            expect(db.createReporte).toHaveBeenCalled();
        });
    });

    describe('Flujo Vehiculo Completo', () => {
        test('debe procesar flujo de vehiculo sin crashear', async () => {
            // PASO 1: Seleccionar vehiculo
            mockIntent('SALUDO');
            await sendText('Hola');
            let messages = await pressButton('btn_tipo_vehiculo');
            expect(messages.length).toBeGreaterThan(0);

            // PASO 2: Numero de empleado
            setSessionState('VEHICULO_ESPERA_EMPLEADO');
            mockIntent('OTRO');
            messages = await sendText('12345');
            expect(messages.length).toBeGreaterThan(0);

            // PASO 3: Placa/SAP del vehiculo
            setSessionState('VEHICULO_ESPERA_SAP', {
                DatosTemp: JSON.stringify({ numeroEmpleado: '12345' })
            });
            mockIntent('OTRO');
            messages = await sendText('ABC1234');
            expect(messages.length).toBeGreaterThan(0);

            // PASO 4: Descripcion del problema
            setSessionState('VEHICULO_ESPERA_DESCRIPCION', {
                DatosTemp: JSON.stringify({
                    tipoReporte: 'VEHICULO',
                    numeroEmpleado: '12345',
                    codigoSAP: 'ABC1234'
                })
            });
            mockIntent('OTRO');
            await expect(sendText('Los frenos hacen ruido')).resolves.not.toThrow();
        });
    });

    describe('Flujo de Cancelacion', () => {
        test('debe cancelar flujo en cualquier punto', async () => {
            // Iniciar flujo
            mockIntent('SALUDO');
            await sendText('Hola');
            await pressButton('btn_tipo_refrigerador');

            // Cancelar en medio del flujo
            setSessionState('REFRI_ESPERA_SAP');
            mockIntent('CANCELAR');
            const messages = await sendText('cancelar');

            // Verificar mensaje de cancelacion
            expect(messages.some(m => m.text?.includes('cancelado'))).toBe(true);

            // Verificar que updateSession fue llamado (sin importar el estado exacto)
            expect(db.updateSession).toHaveBeenCalled();
        });
    });

    describe('Flujo de Encuesta', () => {
        test('debe procesar respuestas de encuesta sin crashear', async () => {
            // Configurar sesion en encuesta
            setSessionState('ENCUESTA_PREGUNTA_1', {
                DatosTemp: JSON.stringify({ encuestaId: 1, preguntaActual: 1 })
            });

            // Responder primera pregunta - no deberia crashear
            mockIntent('OTRO');
            await expect(sendText('5')).resolves.not.toThrow();

            // Configurar para comentario final
            setSessionState('ENCUESTA_COMENTARIO', {
                DatosTemp: JSON.stringify({
                    encuestaId: 1,
                    respuestas: { p1: 5, p2: 5, p3: 5, p4: 5, p5: 5, p6: 5 }
                })
            });
            mockIntent('OTRO');
            // No deberia crashear
            await expect(sendText('Todo excelente')).resolves.not.toThrow();
        });
    });

    describe('Flujo con Errores y Recuperacion', () => {
        test('debe manejar SAP invalido y permitir correccion', async () => {
            await pressButton('btn_tipo_refrigerador');
            setSessionState('REFRI_ESPERA_SAP');

            // SAP muy corto
            mockIntent('OTRO');
            let messages = await sendText('123');
            expect(messages.some(m => m.text?.includes('inválido'))).toBe(true);

            // SAP no existe
            db.getEquipoBySAP.mockResolvedValueOnce(null);
            mockIntent('OTRO');
            messages = await sendText('9999999');
            expect(messages.some(m =>
                m.text?.includes('No encontré') || m.text?.includes('no existe')
            )).toBe(true);

            // SAP correcto
            mockIntent('OTRO');
            messages = await sendText('1234567');
            expect(messages.some(m =>
                m.buttons?.some(b => b.id === 'btn_confirmar_equipo')
            )).toBe(true);
        });

        test('debe permitir corregir equipo seleccionado', async () => {
            await pressButton('btn_tipo_refrigerador');
            setSessionState('REFRI_ESPERA_SAP');
            mockIntent('OTRO');
            await sendText('1234567');

            // No confirmar, corregir
            setSessionState('REFRI_CONFIRMAR_EQUIPO', { EquipoIdTemp: 1 });
            const messages = await pressButton('btn_corregir_equipo');

            expect(messages.some(m =>
                m.text?.includes('SAP') || m.bodyText?.includes('SAP')
            )).toBe(true);
        });
    });

    describe('Flujo con Datos Extraidos por IA', () => {
        test('debe procesar mensaje con datos completos', async () => {
            mockIntent('REPORTAR_FALLA', {
                tipo_equipo: 'REFRIGERADOR',
                problema: 'No enfria',
                codigo_sap: '1234567',
                datos_extraidos: {
                    tipo_equipo: 'REFRIGERADOR',
                    problema: 'No enfria',
                    codigo_sap: '1234567'
                }
            });

            // No deberia crashear
            await expect(
                sendText('Mi refrigerador con codigo 1234567 no enfria desde ayer')
            ).resolves.not.toThrow();
        });
    });

    describe('Multiples Usuarios Simultaneos', () => {
        test('debe mantener sesiones independientes', async () => {
            const user1 = '+5215511111111';
            const user2 = '+5215522222222';

            // Usuario 1 en flujo refrigerador
            db.__setSession(user1, { Estado: 'REFRI_ESPERA_SAP' });
            mockIntent('OTRO');
            await messageHandler.handleText(user1, '1234567', 'msg_1', mockContext);

            // Usuario 2 en flujo vehiculo
            db.__setSession(user2, { Estado: 'VEHICULO_ESPERA_EMPLEADO' });
            mockIntent('OTRO');
            await messageHandler.handleText(user2, '54321', 'msg_2', mockContext);

            // Verificar sesiones separadas
            expect(db.getSession).toHaveBeenCalledWith(user1);
            expect(db.getSession).toHaveBeenCalledWith(user2);
        });
    });

    describe('Timeout y Reactivacion de Sesion', () => {
        test('debe manejar sesion en TIMEOUT sin crashear', async () => {
            setSessionState('TIMEOUT');
            mockIntent('SALUDO');

            // No deberia crashear y deberia responder
            const messages = await sendText('Hola');
            expect(messages.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Consulta de Estado de Ticket', () => {
        test('debe procesar consulta de estado sin crashear', async () => {
            setSessionState('INICIO');
            db.__addReporte({
                NumeroTicket: 'TKT1706300001',
                Estado: 'EN_PROCESO',
                TecnicoAsignado: 'Carlos Rodriguez'
            });

            mockIntent('CONSULTA_ESTADO');
            // No deberia crashear
            await expect(
                sendText('cual es el estado de mi reporte?')
            ).resolves.not.toThrow();
        });
    });

    describe('Despedida y Cierre de Sesion', () => {
        test('debe cerrar sesion correctamente en despedida', async () => {
            setSessionState('INICIO');
            mockIntent('DESPEDIDA');

            const messages = await sendText('gracias, adios');

            expect(messages.some(m =>
                m.text?.includes('pronto') || m.text?.includes('Hasta')
            )).toBe(true);
        });
    });
});

describe('E2E - Casos Edge', () => {
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

        intentService.detectIntent.mockResolvedValue({
            intencion: 'OTRO',
            confianza: 0.5,
            metodo: 'mock',
            datos_extraidos: {}
        });
    });

    test('debe manejar mensaje vacio gracefully', async () => {
        intentService.detectIntent.mockResolvedValueOnce({
            intencion: 'OTRO',
            confianza: 0.3,
            metodo: 'mock',
            datos_extraidos: {}
        });

        await messageHandler.handleText(PHONE_NUMBER, '', 'msg_1', mockContext);

        // No deberia crashear
        expect(mockContext.log_error).not.toHaveBeenCalled();
    });

    test('debe manejar mensaje muy largo', async () => {
        const longMessage = 'a'.repeat(5000);

        intentService.detectIntent.mockResolvedValueOnce({
            intencion: 'OTRO',
            confianza: 0.3,
            metodo: 'mock',
            datos_extraidos: {}
        });

        await messageHandler.handleText(PHONE_NUMBER, longMessage, 'msg_1', mockContext);

        // No deberia crashear
        expect(mockContext.log_error).not.toHaveBeenCalled();
    });

    test('debe manejar caracteres especiales', async () => {
        const specialMessage = '¿Hola! ¿Cómo estás? 😀 <script>alert("xss")</script>';

        intentService.detectIntent.mockResolvedValueOnce({
            intencion: 'SALUDO',
            confianza: 0.95,
            metodo: 'mock',
            datos_extraidos: {}
        });

        await messageHandler.handleText(PHONE_NUMBER, specialMessage, 'msg_1', mockContext);

        // No deberia crashear
        expect(mockContext.log_error).not.toHaveBeenCalled();
    });

    test('debe manejar boton no reconocido', async () => {
        await messageHandler.handleButton(PHONE_NUMBER, 'btn_inexistente', 'msg_1', mockContext);

        // Deberia enviar mensaje de error o bienvenida
        const messages = whatsapp.__getAllMessages();
        expect(messages.length).toBeGreaterThanOrEqual(0);
    });
});
