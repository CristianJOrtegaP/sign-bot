/**
 * Sign Bot - Test Environment Variables
 * Se ejecuta ANTES del framework de Jest (setupFiles)
 */

process.env.NODE_ENV = 'test';

// WhatsApp / Meta
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = 'test-phone-id';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';

// DocuSign
process.env.DOCUSIGN_INTEGRATION_KEY = 'test-integration-key';
process.env.DOCUSIGN_USER_ID = 'test-user-id';
process.env.DOCUSIGN_ACCOUNT_ID = 'test-account-id';
process.env.DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi';
process.env.DOCUSIGN_RSA_PRIVATE_KEY = 'test-rsa-key';
process.env.DOCUSIGN_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.DOCUSIGN_ENVELOPE_EXPIRATION_DAYS = '365';

// Firma - Configuracion de recordatorios y limpieza
process.env.FIRMA_REMINDER_HOURS_CLIENTE = '48';
process.env.FIRMA_MAX_RECORDATORIOS_CLIENTE = '5';
process.env.FIRMA_REMINDER_DAYS_SAP = '7';
process.env.FIRMA_HOUSEKEEPING_DAYS = '30';

// Azure Blob Storage
process.env.BLOB_CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net';

// SQL Server
process.env.SQL_SERVER = 'test-server.database.windows.net';
process.env.SQL_DATABASE = 'test-db';
process.env.SQL_USER = 'test-user';
process.env.SQL_PASSWORD = 'test-password';
process.env.SQL_CONNECTION_STRING =
  'Server=test-server;Database=test-db;User Id=test-user;Password=test-password;';

// Seguridad
process.env.SKIP_SIGNATURE_VALIDATION = 'true';

// Teams
process.env.TEAMS_WEBHOOK_URL = 'https://test.webhook.office.com/webhook';

// App Insights
process.env.APPINSIGHTS_INSTRUMENTATIONKEY = 'test-instrumentation-key';

// Timezone
process.env.TIMEZONE_OFFSET_HOURS = '-6';
