/**
 * SIGN BOT - Configuracion Centralizada
 * Todas las constantes, magic numbers y variables de entorno en un solo lugar
 */

// ============================================================================
// VALIDACION DE VARIABLES DE ENTORNO REQUERIDAS
// ============================================================================

const REQUIRED_ENV_VARS = [
  'SQL_CONNECTION_STRING',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_VERIFY_TOKEN',
];

const OPTIONAL_ENV_VARS = [
  // DOCUSIGN
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_BASE_URL',
  'DOCUSIGN_RSA_PRIVATE_KEY',
  'DOCUSIGN_WEBHOOK_SECRET',
  'DOCUSIGN_ENVELOPE_EXPIRATION_DAYS',
  // FIRMA CONFIG
  'FIRMA_REMINDER_HOURS_CLIENTE',
  'FIRMA_MAX_RECORDATORIOS_CLIENTE',
  'FIRMA_REMINDER_DAYS_SAP',
  'FIRMA_HOUSEKEEPING_DAYS',
  'FIRMA_TIMER_SCHEDULE',
  // STORAGE
  'BLOB_CONNECTION_STRING',
  // SESIONES
  'SESSION_TIMEOUT_MINUTES',
  'SESSION_WARNING_MINUTES',
  'TIMER_SCHEDULE',
  // SEGURIDAD
  'WHATSAPP_APP_SECRET',
  'ADMIN_RATE_LIMIT_MAX',
  // ALERTAS
  'TEAMS_WEBHOOK_URL',
];

/**
 * Valida que las variables de entorno requeridas esten definidas
 * Nota: Usa console.* durante startup ya que el logger puede no estar inicializado
 * @throws {Error} Si falta alguna variable requerida
 */
function validateEnvVars() {
  const missing = REQUIRED_ENV_VARS.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    console.error('[CONFIG] ERROR: Variables de entorno faltantes:', missing.join(', '));
    throw new Error(`Variables de entorno requeridas no definidas: ${missing.join(', ')}`);
  }

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
// CONFIGURACION DE BASE DE DATOS
// ============================================================================

const database = {
  connectionString: process.env.SQL_CONNECTION_STRING,

  connectionTimeout: 30000,
  requestTimeout: 15000,

  sessionCache: {
    ttlMs: 5 * 60 * 1000,
    cleanupIntervalMs: 2 * 60 * 1000,
  },

  documentCache: {
    ttlMs: 10 * 60 * 1000, // 10 minutos para documentos
    cleanupIntervalMs: 2 * 60 * 1000,
  },

  pool: {
    min: Math.max(0, parseInt(process.env.SQL_POOL_MIN || '0', 10)),
    max: Math.max(1, parseInt(process.env.SQL_POOL_MAX || '10', 10)),
    idleTimeoutMillis: parseInt(process.env.SQL_POOL_IDLE_TIMEOUT_MS || '120000', 10),
    acquireTimeoutMillis: parseInt(process.env.SQL_POOL_ACQUIRE_TIMEOUT_MS || '15000', 10),
  },

  retry: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  },

  reconnectErrorCodes: ['ECONNRESET', 'ESOCKET', 'ECONNREFUSED', 'ETIMEDOUT', 'ETIMEOUT'],

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
// CONFIGURACION DE BLOB STORAGE
// ============================================================================

const blob = {
  connectionString: process.env.BLOB_CONNECTION_STRING,
  containerName: 'documentos-firma',

  sasExpiryHours: Math.min(
    Math.max(1, parseInt(process.env.BLOB_SAS_EXPIRY_HOURS || '72', 10) || 72),
    8760
  ),

  maxPdfSizeMB: parseInt(process.env.MAX_PDF_SIZE_MB || '25', 10),
};

// ============================================================================
// CONFIGURACION DE WHATSAPP
// ============================================================================

const whatsapp = {
  apiUrl: 'https://graph.facebook.com/v22.0',
  phoneNumberId: process.env.WHATSAPP_PHONE_ID,
  accessToken: process.env.WHATSAPP_TOKEN,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,

  timeout: {
    defaultMs: 10000,
    mediaDownloadMs: 30000,
  },

  retry: {
    maxRetries: 2,
    delayMs: 1000,
    retryOnCodes: [
      'ECONNABORTED',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'ENETUNREACH',
    ],
  },

  limits: {
    buttonTitleMaxLength: 20,
  },
};

// ============================================================================
// CONFIGURACION DE DOCUSIGN
// ============================================================================

const docusign = {
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
  userId: process.env.DOCUSIGN_USER_ID,
  accountId: process.env.DOCUSIGN_ACCOUNT_ID,
  baseUrl: process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi',
  rsaPrivateKey: process.env.DOCUSIGN_RSA_PRIVATE_KEY,
  webhookSecret: process.env.DOCUSIGN_WEBHOOK_SECRET,

  envelopeExpirationDays: parseInt(process.env.DOCUSIGN_ENVELOPE_EXPIRATION_DAYS || '365', 10),

  // OAuth
  oauthBaseUrl: (process.env.DOCUSIGN_BASE_URL || '').includes('demo')
    ? 'https://account-d.docusign.com'
    : 'https://account.docusign.com',

  // Timeouts
  timeout: {
    defaultMs: 15000,
    uploadMs: 60000,
  },

  // Reintentos
  retry: {
    maxRetries: 2,
    delayMs: 2000,
  },
};

// ============================================================================
// CONFIGURACION DE FIRMA (RECORDATORIOS Y HOUSEKEEPING)
// ============================================================================

const firma = {
  reminderHoursCliente: parseInt(process.env.FIRMA_REMINDER_HOURS_CLIENTE || '48', 10),
  maxRecordatoriosCliente: parseInt(process.env.FIRMA_MAX_RECORDATORIOS_CLIENTE || '5', 10),
  reminderDaysSap: parseInt(process.env.FIRMA_REMINDER_DAYS_SAP || '7', 10),
  housekeepingDays: parseInt(process.env.FIRMA_HOUSEKEEPING_DAYS || '30', 10),
  timerSchedule: process.env.FIRMA_TIMER_SCHEDULE || '0 0 * * * *',
};

// Validar configuracion de firma
if (isNaN(firma.reminderHoursCliente) || firma.reminderHoursCliente < 1) {
  console.warn('[CONFIG] WARN: FIRMA_REMINDER_HOURS_CLIENTE invalido, usando default de 48 horas');
  firma.reminderHoursCliente = 48;
}

if (isNaN(firma.maxRecordatoriosCliente) || firma.maxRecordatoriosCliente < 1) {
  console.warn('[CONFIG] WARN: FIRMA_MAX_RECORDATORIOS_CLIENTE invalido, usando default de 5');
  firma.maxRecordatoriosCliente = 5;
}

if (isNaN(firma.housekeepingDays) || firma.housekeepingDays < 7) {
  console.warn('[CONFIG] WARN: FIRMA_HOUSEKEEPING_DAYS invalido, usando default de 30 dias');
  firma.housekeepingDays = 30;
}

// ============================================================================
// CONFIGURACION DE RATE LIMITING
// ============================================================================

const rateLimiting = {
  messages: {
    maxPerMinute: 20,
    maxPerHour: 100,
    windowMinuteMs: 60000,
    windowHourMs: 3600000,
  },

  spam: {
    windowMs: 10000,
    maxMessagesInWindow: 10,
  },

  cleanupIntervalMs: 5 * 60 * 1000,
};

// ============================================================================
// CONFIGURACION DE SESIONES
// ============================================================================

const session = {
  timeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30', 10),
  warningMinutes: parseInt(process.env.SESSION_WARNING_MINUTES || '25', 10),
  timerSchedule: process.env.TIMER_SCHEDULE || '0 */5 * * * *',
  defaultState: 'INICIO',
};

// Validar timeout de sesion
if (isNaN(session.timeoutMinutes) || session.timeoutMinutes <= 0) {
  console.warn('[CONFIG] WARN: SESSION_TIMEOUT_MINUTES invalido, usando default de 30 minutos');
  session.timeoutMinutes = 30;
}

// Validar warning de sesion
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
// CONFIGURACION DE METRICAS
// ============================================================================

const metrics = {
  printIntervalMs: 5 * 60 * 1000,
};

// ============================================================================
// CONFIGURACION DE AZURE CACHE FOR REDIS
// ============================================================================

const redis = {
  enabled: process.env.REDIS_ENABLED === 'true',
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS !== 'false',

  ttl: {
    session: 5 * 60,
    document: 10 * 60,
    default: 5 * 60,
  },

  reconnect: {
    maxRetries: 3,
    retryDelayMs: 1000,
  },

  keyPrefix: process.env.REDIS_KEY_PREFIX || 'signbot:',
};

// ============================================================================
// CONFIGURACION DE AZURE SERVICE BUS
// ============================================================================

const serviceBus = {
  enabled: process.env.SERVICEBUS_ENABLED === 'true',
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING,

  queueName: process.env.SERVICEBUS_QUEUE_NAME || 'signbot-messages',
  dlqName: process.env.SERVICEBUS_DLQ_NAME || 'signbot-dlq',

  maxDeliveryCount: 3,
  lockDurationMs: 60000,
  messageTimeToLiveMs: 24 * 60 * 60 * 1000,

  maxConcurrentCalls: 5,
  receiveMode: 'peekLock',
};

// ============================================================================
// CONFIGURACION DE PROCESAMIENTO EN BACKGROUND
// ============================================================================

const backgroundProcessor = {
  maxConcurrent: parseInt(process.env.BACKGROUND_MAX_CONCURRENT || '10', 10),
};

// ============================================================================
// CONFIGURACION DE TEAMS
// ============================================================================

const teams = {
  webhookUrl: process.env.TEAMS_WEBHOOK_URL,
};

// ============================================================================
// EXPORTAR CONFIGURACION
// ============================================================================

module.exports = {
  validateEnvVars,

  database,
  blob,
  whatsapp,
  docusign,
  firma,
  rateLimiting,
  session,
  metrics,
  redis,
  serviceBus,
  backgroundProcessor,
  teams,

  // Acceso rapido a valores comunes
  sessionTimeoutMinutes: session.timeoutMinutes,
  isRedisEnabled: redis.enabled,
  isServiceBusEnabled: serviceBus.enabled,
};
