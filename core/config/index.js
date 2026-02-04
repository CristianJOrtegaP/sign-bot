/**
 * AC FIXBOT - Configuración Centralizada
 * Todas las constantes, magic numbers y variables de entorno en un solo lugar
 */

// ============================================================================
// VALIDACIÓN DE VARIABLES DE ENTORNO REQUERIDAS
// ============================================================================

const REQUIRED_ENV_VARS = [
  'SQL_CONNECTION_STRING',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_VERIFY_TOKEN',
];

const OPTIONAL_ENV_VARS = [
  'GEMINI_API_KEY',
  'USE_AI',
  'AI_PROVIDER', // 'gemini' o 'azure-openai'
  'AZURE_OPENAI_ENDPOINT', // Endpoint de Azure OpenAI
  'AZURE_OPENAI_KEY', // API Key de Azure OpenAI
  'AZURE_OPENAI_DEPLOYMENT', // Nombre del deployment (modelo)
  'AZURE_AUDIO_DEPLOYMENT', // Nombre del deployment de audio (gpt-4o-mini-audio)
  'AUDIO_TRANSCRIPTION_ENABLED', // Habilitar transcripción de audio (true/false)
  'VISION_ENDPOINT',
  'VISION_KEY',
  'BLOB_CONNECTION_STRING',
  'SESSION_TIMEOUT_MINUTES',
  'SESSION_WARNING_MINUTES',
  'TIMER_SCHEDULE',
  'SURVEY_TIMER_SCHEDULE', // Horario del timer de encuestas (CRON)
  'SURVEY_HORAS_ESPERA', // Horas a esperar después de resolución
  'SURVEY_HORAS_EXPIRACION', // Horas para expirar encuestas sin respuesta
  // SEGURIDAD
  'WHATSAPP_APP_SECRET', // App Secret para verificar firma X-Hub-Signature-256
  'ADMIN_API_KEY', // API Key para endpoints administrativos
  'IP_RATE_LIMIT', // Límite de requests por IP (default: 100)
  'IP_RATE_WINDOW_MS', // Ventana de rate limit en ms (default: 60000)
  // AZURE MAPS
  'AZURE_MAPS_KEY', // API Key de Azure Maps para geocoding y routing
  'ROUTE_BUFFER_MINUTES', // Minutos adicionales a sumar al tiempo de ruta (default: 20)
];

/**
 * Valida que las variables de entorno requeridas estén definidas
 * Nota: Usa console.* durante startup ya que el logger puede no estar inicializado
 * @throws {Error} Si falta alguna variable requerida
 */
function validateEnvVars() {
  const missing = REQUIRED_ENV_VARS.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    // Usar console.error durante startup (logger no disponible)
    console.error('[CONFIG] ERROR: Variables de entorno faltantes:', missing.join(', '));
    throw new Error(`Variables de entorno requeridas no definidas: ${missing.join(', ')}`);
  }

  // Advertir sobre variables opcionales faltantes (solo en desarrollo)
  if (process.env.NODE_ENV !== 'production') {
    const missingOptional = OPTIONAL_ENV_VARS.filter((varName) => !process.env[varName]);
    if (missingOptional.length > 0) {
      console.warn(
        '[CONFIG] WARN: Variables de entorno opcionales no definidas:',
        missingOptional.join(', ')
      );
    }
  }
}

// ============================================================================
// CONFIGURACIÓN DE BASE DE DATOS
// ============================================================================

const database = {
  connectionString: process.env.SQL_CONNECTION_STRING,

  // Timeouts de conexión (en ms)
  connectionTimeout: 30000, // 30 segundos para establecer conexión
  requestTimeout: 30000, // 30 segundos para queries (default mssql es 15s)

  // Cache de sesiones
  sessionCache: {
    ttlMs: 5 * 60 * 1000, // 5 minutos
    cleanupIntervalMs: 2 * 60 * 1000, // Limpieza cada 2 minutos
  },

  // Cache de equipos
  equipoCache: {
    ttlMs: 15 * 60 * 1000, // 15 minutos (equipos cambian menos)
    cleanupIntervalMs: 2 * 60 * 1000,
  },

  // Reintentos de conexión
  retry: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  },

  // Códigos de error que ameritan reconexión
  reconnectErrorCodes: ['ECONNRESET', 'ESOCKET', 'ECONNREFUSED', 'ETIMEDOUT', 'ETIMEOUT'],

  // Errores transitorios de SQL que ameritan reintento
  transientErrorNumbers: [
    -2, // Timeout
    -1, // Network error
    233, // Connection-level error
    10053, // Connection aborted
    10054, // Connection reset
    10060, // Connection timeout
    40197, // Service busy
    40501, // Service busy
    40613, // Database unavailable
    49918, // Insufficient resources
    49919, // Too many requests
    49920, // Too many requests
  ],
};

// ============================================================================
// CONFIGURACIÓN DE WHATSAPP
// ============================================================================

const whatsapp = {
  apiUrl: 'https://graph.facebook.com/v22.0',
  phoneNumberId: process.env.WHATSAPP_PHONE_ID,
  accessToken: process.env.WHATSAPP_TOKEN,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,

  // Timeouts HTTP
  timeout: {
    defaultMs: 10000, // 10 segundos para requests normales
    mediaDownloadMs: 30000, // 30 segundos para descarga de archivos
  },

  // Reintentos
  retry: {
    maxRetries: 2,
    delayMs: 1000,
    retryOnCodes: ['ECONNABORTED'],
  },

  // Límites de la API
  limits: {
    buttonTitleMaxLength: 20, // Máximo 20 caracteres en títulos de botones
  },
};

// ============================================================================
// CONFIGURACIÓN DE IA (GEMINI / AZURE OPENAI)
// ============================================================================

const ai = {
  enabled: process.env.USE_AI === 'true',

  // Provider de IA: 'gemini' (POC) o 'azure-openai' (Producción)
  // Cambiar esta variable para alternar entre proveedores
  provider: process.env.AI_PROVIDER || 'gemini',

  // Configuración de Gemini (POC)
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-flash',
  },

  // Configuración de Azure OpenAI (Producción)
  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini',
  },

  // Umbrales de confianza (compartidos entre proveedores)
  confidence: {
    high: 0.9, // Confianza alta (regex)
    medium: 0.7, // Confianza media (threshold para usar resultado de IA)
    low: 0.5, // Confianza baja (fallback)
    minimum: 0.3, // Confianza mínima
  },

  // Longitud de mensaje para decidir método de detección
  messageLengthThreshold: 30, // >30 chars = mensaje largo
};

// ============================================================================
// CONFIGURACIÓN DE RATE LIMITING
// ============================================================================

const rateLimiting = {
  messages: {
    maxPerMinute: 20,
    maxPerHour: 100,
    windowMinuteMs: 60000,
    windowHourMs: 3600000,
  },

  images: {
    maxPerMinute: 3,
    maxPerHour: 20,
    windowMinuteMs: 60000,
    windowHourMs: 3600000,
  },

  audios: {
    maxPerMinute: 3,
    maxPerHour: 30,
    windowMinuteMs: 60000,
    windowHourMs: 3600000,
  },

  spam: {
    windowMs: 10000, // Ventana de 10 segundos
    maxMessagesInWindow: 10, // Más de 10 mensajes = spam (aumentado para encuestas)
  },

  cleanupIntervalMs: 5 * 60 * 1000, // Limpiar cada 5 minutos
};

// ============================================================================
// CONFIGURACIÓN DE SESIONES
// ============================================================================

const session = {
  // Timeout total: minutos de inactividad antes de cerrar sesión
  timeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30', 10),
  // Advertencia: minutos de inactividad antes de enviar "¿Sigues ahí?"
  // Por defecto es 5 minutos antes del timeout (ej: timeout=30, warning=25)
  warningMinutes: parseInt(process.env.SESSION_WARNING_MINUTES || '25', 10),
  // Schedule del timer en formato CRON (segundo minuto hora dia mes dia-semana)
  // Default: cada 5 minutos
  timerSchedule: process.env.TIMER_SCHEDULE || '0 */5 * * * *',
  defaultState: 'INICIO',

  // Estados válidos de sesión
  states: {
    INICIO: 'INICIO',
    ESPERA_NUMERO_EMPLEADO: 'ESPERA_NUMERO_EMPLEADO',
    ESPERA_SAP_VEHICULO: 'ESPERA_SAP_VEHICULO',
    ESPERA_SAP: 'ESPERA_SAP',
    CONFIRMAR_EQUIPO: 'CONFIRMAR_EQUIPO',
    ESPERA_DESCRIPCION: 'ESPERA_DESCRIPCION',
  },
};

// Validar timeout de sesión
if (isNaN(session.timeoutMinutes) || session.timeoutMinutes <= 0) {
  console.warn('[CONFIG] WARN: SESSION_TIMEOUT_MINUTES invalido, usando default de 30 minutos');
  session.timeoutMinutes = 30;
}

// Validar warning de sesión
if (isNaN(session.warningMinutes) || session.warningMinutes <= 0) {
  console.warn('[CONFIG] WARN: SESSION_WARNING_MINUTES invalido, usando default de 25 minutos');
  session.warningMinutes = 25;
}

// Asegurar que warning sea menor que timeout
if (session.warningMinutes >= session.timeoutMinutes) {
  console.warn(
    `[CONFIG] WARN: SESSION_WARNING_MINUTES (${session.warningMinutes}) debe ser menor que SESSION_TIMEOUT_MINUTES (${session.timeoutMinutes}). Ajustando a ${session.timeoutMinutes - 5} minutos.`
  );
  session.warningMinutes = Math.max(session.timeoutMinutes - 5, 1);
}

// ============================================================================
// CONFIGURACIÓN DE VISION (OCR)
// ============================================================================

const vision = {
  endpoint: process.env.VISION_ENDPOINT,
  apiKey: process.env.VISION_KEY,

  ocr: {
    language: 'es',
    maxAttempts: 15, // Máximo 15 intentos de polling
    pollingIntervalMs: 1000, // Esperar 1 segundo entre intentos
  },

  // Patrón para código SAP (7 dígitos)
  sapCodePattern: /\b(\d{7})\b/,
};

// ============================================================================
// CONFIGURACIÓN DE AZURE MAPS (Geocoding + Routing)
// ============================================================================

const azureMaps = {
  // API Key de Azure Maps (subscription key)
  apiKey: process.env.AZURE_MAPS_KEY,

  // Base URL de Azure Maps REST API
  baseUrl: 'https://atlas.microsoft.com',

  // Versión de la API
  apiVersion: '1.0',

  // Tiempo buffer a sumar al tiempo de ruta (minutos)
  // Este es el tiempo adicional para preparación, imponderables, etc.
  routeBufferMinutes: parseInt(process.env.ROUTE_BUFFER_MINUTES || '20', 10),

  // Timeouts HTTP
  timeout: {
    geocodingMs: 10000, // 10 segundos para geocoding
    routingMs: 15000, // 15 segundos para routing (puede ser más lento)
  },

  // Opciones de routing
  routing: {
    travelMode: 'car', // Modo de viaje: car, truck, taxi, bus, van, motorcycle, bicycle, pedestrian
    traffic: true, // Considerar tráfico en tiempo real
    routeType: 'fastest', // Tipo de ruta: fastest, shortest, eco, thrilling
    computeTravelTimeFor: 'all', // all = devuelve tiempo con y sin tráfico
  },
};

// Validar buffer de minutos
if (isNaN(azureMaps.routeBufferMinutes) || azureMaps.routeBufferMinutes < 0) {
  console.warn('[CONFIG] WARN: ROUTE_BUFFER_MINUTES invalido, usando default de 20 minutos');
  azureMaps.routeBufferMinutes = 20;
}

// ============================================================================
// CONFIGURACIÓN DE TRANSCRIPCIÓN DE AUDIO (GPT-4o-mini-audio)
// ============================================================================

const audio = {
  // Habilitar transcripción de audio (requiere Azure OpenAI con Whisper o gpt-4o-mini-audio)
  enabled: process.env.AUDIO_TRANSCRIPTION_ENABLED === 'true',

  // Endpoint de Azure OpenAI para audio (puede ser recurso separado para Whisper)
  endpoint: process.env.AZURE_AUDIO_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT,

  // API Key para el recurso de audio
  apiKey: process.env.AZURE_AUDIO_KEY || process.env.AZURE_OPENAI_KEY,

  // Nombre del deployment de audio en Azure OpenAI
  audioDeployment: process.env.AZURE_AUDIO_DEPLOYMENT || 'whisper',

  // Límites de audio
  limits: {
    maxFileSizeBytes: 25 * 1024 * 1024, // 25MB
    minFileSizeBytes: 1024, // 1KB mínimo
    maxDurationSeconds: 300, // 5 minutos máximo (recomendado)
  },

  // Timeout para transcripción (ms)
  timeoutMs: 60000, // 60 segundos

  // Idioma principal para transcripción
  language: 'es',

  // Rate limiting para audios (ahora más generoso con gpt-4o-mini-audio)
  rateLimit: {
    maxPerMinute: 30, // Mucho más alto que Whisper
    maxPerHour: 500,
  },
};

// ============================================================================
// CONFIGURACIÓN DE ENCUESTAS DE SATISFACCIÓN
// ============================================================================

const survey = {
  // Schedule del timer (CRON): default 9:00 AM diario (hora del servidor/Azure)
  timerSchedule: process.env.SURVEY_TIMER_SCHEDULE || '0 0 9 * * *',
  // Horas mínimas de espera después de resolución antes de enviar encuesta
  horasEspera: parseInt(process.env.SURVEY_HORAS_ESPERA || '24', 10),
  // Horas para expirar encuestas sin respuesta
  horasExpiracion: parseInt(process.env.SURVEY_HORAS_EXPIRACION || '72', 10),
  // Máximo de encuestas a enviar por ejecución del timer
  maxPorEjecucion: 50,
  // Pausa entre envíos (ms)
  pausaEntreEnviosMs: 1000,
};

// Validar configuración de encuestas
if (isNaN(survey.horasEspera) || survey.horasEspera < 1) {
  console.warn('[CONFIG] WARN: SURVEY_HORAS_ESPERA invalido, usando default de 24 horas');
  survey.horasEspera = 24;
}

if (isNaN(survey.horasExpiracion) || survey.horasExpiracion < survey.horasEspera) {
  console.warn('[CONFIG] WARN: SURVEY_HORAS_EXPIRACION invalido, usando default de 72 horas');
  survey.horasExpiracion = 72;
}

// ============================================================================
// CONFIGURACIÓN DE MÉTRICAS
// ============================================================================

const metrics = {
  printIntervalMs: 5 * 60 * 1000, // Imprimir resumen cada 5 minutos
};

// ============================================================================
// CONFIGURACIÓN DE VALIDACIÓN
// ============================================================================

const validation = {
  sapCode: {
    minLength: 5, // Longitud mínima para código SAP
  },
};

// ============================================================================
// TIPOS DE EQUIPO E INTENCIONES
// ============================================================================

const equipmentTypes = {
  REFRIGERADOR: 'REFRIGERADOR',
  VEHICULO: 'VEHICULO',
  OTRO: 'OTRO',
};

const intents = {
  SALUDO: 'SALUDO',
  REPORTAR_FALLA: 'REPORTAR_FALLA',
  TIPO_REFRIGERADOR: 'TIPO_REFRIGERADOR',
  TIPO_VEHICULO: 'TIPO_VEHICULO',
  DESPEDIDA: 'DESPEDIDA',
  OTRO: 'OTRO',
};

const reportTypes = {
  REFRIGERADOR: 'REFRIGERADOR',
  VEHICULO: 'VEHICULO',
};

// ============================================================================
// EXPORTAR CONFIGURACIÓN
// ============================================================================

module.exports = {
  // Funciones de utilidad
  validateEnvVars,

  // Configuraciones por módulo
  database,
  whatsapp,
  ai,
  audio,
  rateLimiting,
  session,
  survey,
  vision,
  azureMaps,
  metrics,
  validation,

  // Enums/Constantes
  equipmentTypes,
  intents,
  reportTypes,

  // Acceso rápido a valores comunes
  isAIEnabled: ai.enabled,
  sessionTimeoutMinutes: session.timeoutMinutes,
};
