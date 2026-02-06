/**
 * AC FIXBOT - Key Vault Service
 * Servicio para obtener secretos desde Azure Key Vault
 *
 * En producción, los secretos se obtienen de Key Vault usando Managed Identity.
 * En desarrollo, se usan variables de entorno directamente.
 *
 * Uso:
 *   const keyVault = require('./keyVaultService');
 *   const secret = await keyVault.getSecret('WHATSAPP-TOKEN');
 */

const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

// Cache de secretos para evitar llamadas repetidas
const secretsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Cliente de Key Vault (inicializado lazy)
let secretClient = null;

/**
 * Inicializa el cliente de Key Vault
 * @returns {SecretClient|null} Cliente de Key Vault o null si no está configurado
 */
function initializeClient() {
  if (secretClient) {
    return secretClient;
  }

  const keyVaultUri = process.env.KEY_VAULT_URI;

  if (!keyVaultUri) {
    console.warn('[KeyVault] KEY_VAULT_URI no configurado - usando variables de entorno');
    return null;
  }

  try {
    // DefaultAzureCredential usa Managed Identity en Azure
    // y credenciales locales (az login) en desarrollo
    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(keyVaultUri, credential);
    console.log(`[KeyVault] Conectado a: ${keyVaultUri}`);
    return secretClient;
  } catch (error) {
    console.error('[KeyVault] Error inicializando cliente:', error.message);
    return null;
  }
}

/**
 * Obtiene un secreto de Key Vault o de variables de entorno
 * @param {string} secretName - Nombre del secreto (usa guiones, ej: WHATSAPP-TOKEN)
 * @param {string} [envVarName] - Nombre de variable de entorno alternativa (usa guiones bajos)
 * @returns {Promise<string|undefined>} Valor del secreto
 */
async function getSecret(secretName, envVarName = null) {
  // Convertir nombre de secreto a nombre de variable de entorno
  // Key Vault usa guiones, env vars usan guiones bajos
  const envName = envVarName || secretName.replace(/-/g, '_');

  // En desarrollo o si no hay Key Vault, usar variables de entorno
  const client = initializeClient();
  if (!client) {
    return process.env[envName];
  }

  // Verificar cache
  const cached = secretsCache.get(secretName);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const secret = await client.getSecret(secretName);

    // Guardar en cache
    secretsCache.set(secretName, {
      value: secret.value,
      timestamp: Date.now(),
    });

    return secret.value;
  } catch (error) {
    // Si falla Key Vault, intentar con variable de entorno
    console.warn(`[KeyVault] Error obteniendo ${secretName}: ${error.message}`);
    console.warn(`[KeyVault] Fallback a variable de entorno: ${envName}`);
    return process.env[envName];
  }
}

/**
 * Obtiene múltiples secretos en paralelo
 * @param {string[]} secretNames - Lista de nombres de secretos
 * @returns {Promise<Object>} Objeto con los secretos {nombre: valor}
 */
async function getSecrets(secretNames) {
  const results = await Promise.all(
    secretNames.map(async (name) => {
      const value = await getSecret(name);
      return [name, value];
    })
  );

  return Object.fromEntries(results);
}

/**
 * Limpia la cache de secretos
 * Útil para forzar recarga de secretos actualizados
 */
function clearCache() {
  secretsCache.clear();
  console.log('[KeyVault] Cache limpiado');
}

/**
 * Verifica si Key Vault está habilitado
 * @returns {boolean}
 */
function isEnabled() {
  return Boolean(process.env.KEY_VAULT_URI);
}

/**
 * Lista los secretos disponibles en Key Vault
 * Solo para diagnóstico - no expone valores
 * @returns {Promise<string[]>} Lista de nombres de secretos
 */
async function listSecretNames() {
  const client = initializeClient();
  if (!client) {
    return [];
  }

  try {
    const names = [];
    for await (const secretProperties of client.listPropertiesOfSecrets()) {
      names.push(secretProperties.name);
    }
    return names;
  } catch (error) {
    console.error('[KeyVault] Error listando secretos:', error.message);
    return [];
  }
}

// Mapeo de nombres de secretos en Key Vault a variables de entorno
const SECRET_MAPPING = {
  // WhatsApp
  'WHATSAPP-TOKEN': 'WHATSAPP_TOKEN',
  'WHATSAPP-APP-SECRET': 'WHATSAPP_APP_SECRET',
  'WHATSAPP-VERIFY-TOKEN': 'WHATSAPP_VERIFY_TOKEN',

  // Database
  'SQL-CONNECTION-STRING': 'SQL_CONNECTION_STRING',

  // AI
  'AZURE-OPENAI-KEY': 'AZURE_OPENAI_KEY',
  'GEMINI-API-KEY': 'GEMINI_API_KEY',

  // Vision
  'VISION-KEY': 'VISION_KEY',

  // Storage
  'BLOB-CONNECTION-STRING': 'BLOB_CONNECTION_STRING',
  'STORAGE-ACCOUNT-KEY': 'AzureWebJobsStorage',

  // Maps
  'AZURE-MAPS-KEY': 'AZURE_MAPS_KEY',

  // Speech
  'AZURE-SPEECH-KEY': 'AZURE_SPEECH_KEY',
};

/**
 * Inicializa todos los secretos de Key Vault en variables de entorno
 * Llamar al inicio de la aplicación en producción
 * @returns {Promise<number>} Número de secretos cargados
 */
async function initializeSecrets() {
  if (!isEnabled()) {
    console.log('[KeyVault] No habilitado - usando variables de entorno locales');
    return 0;
  }

  console.log('[KeyVault] Inicializando secretos desde Key Vault...');
  let loaded = 0;

  for (const [kvName, envName] of Object.entries(SECRET_MAPPING)) {
    try {
      const value = await getSecret(kvName, envName);
      if (value) {
        process.env[envName] = value;
        loaded++;
        console.log(`[KeyVault] Cargado: ${kvName} -> ${envName}`);
      }
    } catch (error) {
      console.warn(`[KeyVault] No se pudo cargar ${kvName}: ${error.message}`);
    }
  }

  console.log(`[KeyVault] ${loaded} secretos cargados`);
  return loaded;
}

module.exports = {
  getSecret,
  getSecrets,
  clearCache,
  isEnabled,
  listSecretNames,
  initializeSecrets,
  SECRET_MAPPING,
};
