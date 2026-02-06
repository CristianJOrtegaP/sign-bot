/**
 * AC FIXBOT - Test Environment Variables
 * Se ejecuta ANTES del framework de Jest (setupFiles)
 */

process.env.NODE_ENV = 'test';

// WhatsApp / Meta
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = 'test-phone-id';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_WEBHOOK_SECRET = 'test-webhook-secret';

// Azure OpenAI
process.env.AZURE_OPENAI_ENDPOINT = 'https://test-openai.openai.azure.com/';
process.env.AZURE_OPENAI_KEY = 'test-openai-key';
process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-mini';

// Gemini
process.env.GEMINI_API_KEY = 'test-gemini-key';

// Azure Vision / OCR
process.env.AZURE_VISION_ENDPOINT = 'https://test-vision.cognitiveservices.azure.com/';
process.env.AZURE_VISION_KEY = 'test-vision-key';

// Azure Storage
process.env.AZURE_STORAGE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net';

// SQL Server
process.env.SQL_SERVER = 'test-server.database.windows.net';
process.env.SQL_DATABASE = 'test-db';
process.env.SQL_USER = 'test-user';
process.env.SQL_PASSWORD = 'test-password';
process.env.SQL_CONNECTION_STRING =
  'Server=test-server;Database=test-db;User Id=test-user;Password=test-password;';

// AI
process.env.AI_PROVIDER = 'gemini';
process.env.AI_ENABLED = 'true';

// Seguridad
process.env.SKIP_SIGNATURE_VALIDATION = 'true';

// App Insights
process.env.APPINSIGHTS_INSTRUMENTATIONKEY = 'test-instrumentation-key';

// Timezone
process.env.TIMEZONE_OFFSET_HOURS = '-6';
