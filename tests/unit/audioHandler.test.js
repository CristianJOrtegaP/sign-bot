/**
 * Unit Test: Audio Handler
 * Verifica validación de audio, transcripción y procesamiento
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService.mock')
);
jest.mock('../../core/services/storage/databaseService', () =>
  require('../__mocks__/databaseService.mock')
);
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimitDistributed: jest.fn().mockResolvedValue({ allowed: true }),
  recordRequest: jest.fn(),
}));
jest.mock('../../core/services/ai/audioTranscriptionService', () => ({
  isEnabled: jest.fn(() => true),
  transcribeAudio: jest
    .fn()
    .mockResolvedValue({ success: true, text: 'Hola mundo', duration: 100 }),
}));
jest.mock('../../bot/controllers/messageHandler', () => ({
  handleText: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/config', () => ({
  audio: { limits: { maxFileSizeBytes: 25 * 1024 * 1024, minFileSizeBytes: 1024 } },
}));

const {
  handleAudio,
  isAudioTranscriptionEnabled,
  AUDIO_LIMITS,
} = require('../../bot/controllers/audioHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const transcriptionService = require('../../core/services/ai/audioTranscriptionService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('AudioHandler', () => {
  let context;
  const from = '+5215512345678';
  const messageId = 'audio-msg-1';

  beforeEach(() => {
    jest.clearAllMocks();
    context = global.createMockContext();
    transcriptionService.isEnabled.mockReturnValue(true);
    rateLimiter.checkRateLimitDistributed.mockResolvedValue({ allowed: true });
    whatsapp.sendAndSaveText.mockResolvedValue(undefined);
    whatsapp.sendTypingIndicator.mockResolvedValue(undefined);
  });

  // ===========================================================
  // TRANSCRIPCION DESHABILITADA
  // ===========================================================
  describe('transcripción deshabilitada', () => {
    test('debe informar al usuario si la transcripción no está habilitada', async () => {
      transcriptionService.isEnabled.mockReturnValue(false);
      await handleAudio(from, { id: 'audio-1', mime_type: 'audio/ogg' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('no está disponible')
      );
    });

    test('isAudioTranscriptionEnabled debe delegar a transcriptionService', () => {
      transcriptionService.isEnabled.mockReturnValue(false);
      expect(isAudioTranscriptionEnabled()).toBe(false);
      transcriptionService.isEnabled.mockReturnValue(true);
      expect(isAudioTranscriptionEnabled()).toBe(true);
    });
  });

  // ===========================================================
  // VALIDACION DE DATOS
  // ===========================================================
  describe('validación de datos de audio', () => {
    test('debe rechazar audio sin id', async () => {
      await handleAudio(from, {}, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('No pude procesar el audio')
      );
    });

    test('debe rechazar audio con solo mime_type (sin id)', async () => {
      await handleAudio(from, { mime_type: 'audio/ogg' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('No pude procesar el audio')
      );
    });

    test('debe rechazar tipo MIME no permitido', async () => {
      await handleAudio(from, { id: 'audio-1', mime_type: 'audio/wav' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Formato de audio no soportado')
      );
    });

    test('debe rechazar audio demasiado grande', async () => {
      await handleAudio(
        from,
        { id: 'audio-1', mime_type: 'audio/ogg', file_size: AUDIO_LIMITS.MAX_SIZE_BYTES + 1 },
        messageId,
        context
      );
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('demasiado largo')
      );
    });

    test('debe rechazar audio demasiado pequeño', async () => {
      await handleAudio(
        from,
        { id: 'audio-1', mime_type: 'audio/ogg', file_size: 500 },
        messageId,
        context
      );
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('muy corto')
      );
    });
  });

  // ===========================================================
  // RATE LIMITING
  // ===========================================================
  describe('rate limiting', () => {
    test('debe respetar rate limit de audio', async () => {
      rateLimiter.checkRateLimitDistributed.mockResolvedValue({
        allowed: false,
        reason: 'Too many',
      });
      await handleAudio(from, { id: 'audio-1', mime_type: 'audio/ogg' }, messageId, context);
      // No debe notificar procesamiento
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Too many')
      );
    });
  });

  // ===========================================================
  // PROCESAMIENTO NORMAL
  // ===========================================================
  describe('procesamiento normal', () => {
    test('debe enviar mensaje de procesamiento y lanzar background', async () => {
      await handleAudio(from, { id: 'audio-1', mime_type: 'audio/ogg' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Procesando tu mensaje de voz')
      );
      expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith(from, messageId);
    });

    test('debe aceptar audio/ogg; codecs=opus', async () => {
      await handleAudio(
        from,
        { id: 'audio-1', mime_type: 'audio/ogg; codecs=opus' },
        messageId,
        context
      );
      // Debe pasar validación de MIME y llegar al procesamiento
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Procesando tu mensaje de voz')
      );
    });
  });
});
