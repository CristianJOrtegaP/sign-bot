/**
 * Unit Test: Survey Sender Timer
 * CRON que envía encuestas a clientes con tickets resueltos
 */

jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/utils/promises', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

// Mock de repositorios
const mockEncuestaRepo = {
  getReportesPendientesEncuesta: jest.fn(async () => []),
  create: jest.fn(async () => ({ encuestaId: 1, tipoEncuesta: { Codigo: 'SAT' }, preguntas: [] })),
  updateEstado: jest.fn().mockResolvedValue(undefined),
  expirarSinRespuesta: jest.fn(async () => 0),
};
jest.mock('../../bot/repositories/EncuestaRepository', () => mockEncuestaRepo);

const mockSesionRepo = {
  getSession: jest.fn(async () => ({ Estado: 'INICIO' })),
};
jest.mock('../../bot/repositories/SesionRepository', () => mockSesionRepo);

// Mock de encuestaFlow
const mockEncuestaFlow = {
  iniciarEncuesta: jest.fn(async () => true),
};
jest.mock('../../bot/flows/encuestaFlow', () => mockEncuestaFlow);

const { sleep: _sleep } = require('../../core/utils/promises');

describe('Survey Sender Timer', () => {
  let timerFunction;
  let context;
  let myTimer;

  beforeEach(() => {
    jest.resetModules();
    // Re-establecer mocks
    jest.mock('../../core/services/infrastructure/errorHandler', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../core/services/infrastructure/appInsightsService', () =>
      require('../__mocks__/appInsightsService.mock')
    );
    jest.mock('../../core/utils/promises', () => ({
      sleep: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../bot/repositories/EncuestaRepository', () => mockEncuestaRepo);
    jest.mock('../../bot/repositories/SesionRepository', () => mockSesionRepo);
    jest.mock('../../bot/flows/encuestaFlow', () => mockEncuestaFlow);

    timerFunction = require('../../timer-survey-sender');
    context = global.createMockContext();
    myTimer = { isPastDue: false };

    // Reset mocks
    mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([]);
    mockEncuestaRepo.create.mockResolvedValue({
      encuestaId: 1,
      tipoEncuesta: { Codigo: 'SAT' },
      preguntas: [],
    });
    mockEncuestaRepo.updateEstado.mockResolvedValue(undefined);
    mockEncuestaRepo.expirarSinRespuesta.mockResolvedValue(0);
    mockSesionRepo.getSession.mockResolvedValue({ Estado: 'INICIO' });
    mockEncuestaFlow.iniciarEncuesta.mockResolvedValue(true);

    // Forzar ventana horaria abierta (0-24) para que tests no dependan del reloj
    process.env.TIMEZONE_OFFSET_HOURS = '-6';
    process.env.SURVEY_HORA_INICIO = '0';
    process.env.SURVEY_HORA_FIN = '24';
  });

  // ===========================================================
  // ENVIO NORMAL
  // ===========================================================
  describe('envío normal', () => {
    test('debe enviar encuestas a reportes elegibles', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
        { ReporteId: 2, TelefonoReportante: '+52155B', NumeroTicket: 'TKT-002' },
      ]);

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.create).toHaveBeenCalledTimes(2);
      expect(mockEncuestaFlow.iniciarEncuesta).toHaveBeenCalledTimes(2);
    });

    test('no debe enviar si no hay reportes pendientes', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([]);

      await timerFunction(context, myTimer);

      expect(mockEncuestaFlow.iniciarEncuesta).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // THROTTLING
  // ===========================================================
  describe('throttling', () => {
    test('debe limitar a MAX_ENCUESTAS_POR_EJECUCION (50)', async () => {
      const reportes = Array.from({ length: 70 }, (_, i) => ({
        ReporteId: i + 1,
        TelefonoReportante: `+52155${String(i).padStart(4, '0')}`,
        NumeroTicket: `TKT-${i + 1}`,
      }));
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue(reportes);

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.create).toHaveBeenCalledTimes(50);
    });

    test('debe pausar entre envíos (sleep)', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
        { ReporteId: 2, TelefonoReportante: '+52155B', NumeroTicket: 'TKT-002' },
        { ReporteId: 3, TelefonoReportante: '+52155C', NumeroTicket: 'TKT-003' },
      ]);

      await timerFunction(context, myTimer);

      const sleepMock = require('../../core/utils/promises').sleep;
      // Sleep se llama después de cada envío
      expect(sleepMock).toHaveBeenCalledWith(1000);
    });
  });

  // ===========================================================
  // VENTANA HORARIA
  // ===========================================================
  describe('ventana horaria', () => {
    test('no debe enviar fuera de ventana (antes de 8 AM local)', async () => {
      // Restaurar ventana horaria real (8-20) para este test
      process.env.SURVEY_HORA_INICIO = '8';
      process.env.SURVEY_HORA_FIN = '20';

      // Forzar hora fuera de ventana: 13 UTC + offset -6 = 7 AM local (antes de 8)
      const origDate = global.Date;
      const mockDate = new Date('2025-01-15T13:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation((...args) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new origDate(...args);
      });
      global.Date.now = origDate.now;

      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);

      await timerFunction(context, myTimer);

      expect(mockEncuestaFlow.iniciarEncuesta).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });

  // ===========================================================
  // SESION ACTIVA
  // ===========================================================
  describe('sesión activa', () => {
    test('debe omitir usuario con sesión no terminal', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);
      mockSesionRepo.getSession.mockResolvedValue({ Estado: 'REFRIGERADOR_ACTIVO' });

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.create).not.toHaveBeenCalled();
    });

    test('debe enviar si sesión está en estado terminal', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);
      mockSesionRepo.getSession.mockResolvedValue({ Estado: 'FINALIZADO' });

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================
  // ENCUESTA DUPLICADA
  // ===========================================================
  describe('encuesta duplicada', () => {
    test('debe saltar si EncuestaRepository.create retorna null', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);
      mockEncuestaRepo.create.mockResolvedValue(null);

      await timerFunction(context, myTimer);

      expect(mockEncuestaFlow.iniciarEncuesta).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // ERRORES
  // ===========================================================
  describe('manejo de errores', () => {
    test('un error individual no debe detener el resto', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
        { ReporteId: 2, TelefonoReportante: '+52155B', NumeroTicket: 'TKT-002' },
      ]);
      mockEncuestaRepo.create
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ encuestaId: 2, tipoEncuesta: { Codigo: 'SAT' }, preguntas: [] });

      await timerFunction(context, myTimer);

      // Segunda encuesta se envía a pesar del error en la primera
      expect(mockEncuestaFlow.iniciarEncuesta).toHaveBeenCalledTimes(1);
    });

    test('debe marcar como EXPIRADA si no se puede enviar', async () => {
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);
      mockEncuestaFlow.iniciarEncuesta.mockResolvedValue(false); // No enviada

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.updateEstado).toHaveBeenCalledWith(1, 'EXPIRADA');
    });
  });

  // ===========================================================
  // EXPIRACION
  // ===========================================================
  describe('expiración de encuestas antiguas', () => {
    test('debe llamar expirarSinRespuesta al final', async () => {
      // Necesita al menos un reporte para no salir early (línea 70-75 del source)
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([
        { ReporteId: 1, TelefonoReportante: '+52155A', NumeroTicket: 'TKT-001' },
      ]);

      await timerFunction(context, myTimer);

      expect(mockEncuestaRepo.expirarSinRespuesta).toHaveBeenCalledWith(72);
    });
  });

  // ===========================================================
  // isPastDue
  // ===========================================================
  describe('isPastDue', () => {
    test('debe logear advertencia si el timer se ejecuta con retraso', async () => {
      myTimer.isPastDue = true;
      mockEncuestaRepo.getReportesPendientesEncuesta.mockResolvedValue([]);

      await timerFunction(context, myTimer);

      expect(context.log).toHaveBeenCalledWith(expect.stringContaining('retraso'));
    });
  });
});
