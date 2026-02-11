/**
 * Sign Bot - Servicio de Azure Blob Storage
 * Maneja el almacenamiento de imágenes con SAS tokens para acceso seguro
 */

const {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential,
} = require('@azure/storage-blob');
const { URL } = require('url');
const { logger } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');
const config = require('../../config');

const CONTAINER_NAME = config.blob?.containerName || 'imagenes-reportes';
const connectionString = config.blob?.connectionString || process.env.BLOB_CONNECTION_STRING;

// Tiempo de expiración del SAS token (configurable via BLOB_SAS_EXPIRY_HOURS, default: 72h)
const SAS_EXPIRY_MS = (config.blob?.sasExpiryHours || 72) * 60 * 60 * 1000;

// Límites de tamaño de archivo (en bytes)
const MAX_IMAGE_SIZE = (config.blob?.maxImageSizeMB || 10) * 1024 * 1024;
const MAX_AUDIO_SIZE = (config.blob?.maxAudioSizeMB || 25) * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'ogg', 'mp3', 'wav', 'm4a'];

let blobServiceClient = null;
let containerClient = null;
let sharedKeyCredential = null;
let accountName = null;

/**
 * Parsea el connection string para obtener account name y key
 */
function parseConnectionString(connString) {
  const parts = connString.split(';').reduce((acc, part) => {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length) {
      acc[key] = valueParts.join('=');
    }
    return acc;
  }, {});

  return {
    accountName: parts['AccountName'],
    accountKey: parts['AccountKey'],
  };
}

/**
 * Inicializa el cliente de Blob Storage
 */
async function getContainerClient() {
  if (containerClient) {
    return containerClient;
  }

  if (!connectionString) {
    throw new Error('BLOB_CONNECTION_STRING no está configurado');
  }

  // Parsear connection string para obtener credenciales
  const { accountName: name, accountKey } = parseConnectionString(connectionString);
  accountName = name;
  sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  // Crear contenedor si no existe (sin acceso público - usaremos SAS tokens)
  await containerClient.createIfNotExists();

  logger.info(`Blob container '${CONTAINER_NAME}' inicializado (acceso mediante SAS tokens)`);
  return containerClient;
}

/**
 * Genera un SAS token para un blob específico
 * @param {string} blobName - Nombre del blob
 * @returns {string} - Query string del SAS token
 */
function generateSASToken(blobName) {
  const expiresOn = new Date(Date.now() + SAS_EXPIRY_MS);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobName,
      permissions: BlobSASPermissions.parse('r'), // Solo lectura
      expiresOn: expiresOn,
    },
    sharedKeyCredential
  );

  return sasToken.toString();
}

/**
 * Valida el tamaño y tipo de archivo antes de subir
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} extension - Extensión del archivo
 * @returns {{valid: boolean, error?: string}}
 */
function validateFileUpload(buffer, extension) {
  // Validar extensión
  const ext = extension.toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Extensión no permitida: ${ext}. Permitidas: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  // Determinar límite según tipo
  const isAudio = ['ogg', 'mp3', 'wav', 'm4a'].includes(ext);
  const maxSize = isAudio ? MAX_AUDIO_SIZE : MAX_IMAGE_SIZE;
  const fileType = isAudio ? 'audio' : 'imagen';

  // Validar tamaño
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Archivo vacío' };
  }

  if (buffer.length > maxSize) {
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    const maxMB = (maxSize / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `${fileType} excede tamaño máximo: ${sizeMB}MB > ${maxMB}MB`,
    };
  }

  return { valid: true };
}

/**
 * Sube una imagen al blob storage
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} telefono - Teléfono del usuario (para organizar)
 * @param {string} extension - Extensión del archivo (default: jpg)
 * @returns {Promise<string>} - URL con SAS token para acceder a la imagen
 */
async function uploadImage(imageBuffer, telefono, extension = 'jpg') {
  // Validar archivo antes de subir
  const validation = validateFileUpload(imageBuffer, extension);
  if (!validation.valid) {
    logger.warn('Archivo rechazado en validación', {
      telefono,
      extension,
      size: imageBuffer?.length,
      error: validation.error,
    });
    throw new Error(validation.error);
  }

  // Circuit breaker gate check
  const blobBreaker = getBreaker(SERVICES.BLOB_STORAGE);
  const cbCheck = blobBreaker.canExecute();
  if (!cbCheck.allowed) {
    throw new Error('Blob Storage circuit breaker abierto');
  }

  try {
    const container = await getContainerClient();

    // Generar nombre único: telefono/timestamp_random.jpg
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const blobName = `${telefono}/${timestamp}_${random}.${extension}`;

    const blockBlobClient = container.getBlockBlobClient(blobName);

    // Detectar content type
    const contentType = getContentType(extension);

    // Subir imagen
    await blockBlobClient.upload(imageBuffer, imageBuffer.length, {
      blobHTTPHeaders: {
        blobContentType: contentType,
      },
    });

    // Generar URL con SAS token
    const sasToken = generateSASToken(blobName);
    const urlWithSas = `${blockBlobClient.url}?${sasToken}`;

    blobBreaker.recordSuccess();
    logger.info(`Imagen subida exitosamente con SAS token`, {
      blobName,
      size: imageBuffer.length,
      expiresIn: '1 año',
    });

    return urlWithSas;
  } catch (error) {
    blobBreaker.recordFailure(error);
    logger.error('Error subiendo imagen a Blob Storage', error, {
      operation: 'uploadImage',
      telefono,
    });
    throw error;
  }
}

/**
 * Obtiene el content type según la extensión
 */
function getContentType(extension) {
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return types[extension.toLowerCase()] || 'image/jpeg';
}

/**
 * Elimina una imagen del blob storage
 * @param {string} url - URL de la imagen a eliminar
 */
async function deleteImage(url) {
  try {
    const container = await getContainerClient();

    // Extraer nombre del blob de la URL (ignorar query string del SAS)
    const urlObj = new URL(url);
    const blobName = urlObj.pathname.split(`/${CONTAINER_NAME}/`)[1];

    if (!blobName) {
      logger.warn('No se pudo extraer nombre del blob de la URL', { url });
      return false;
    }

    const blockBlobClient = container.getBlockBlobClient(blobName);
    await blockBlobClient.deleteIfExists();

    logger.info(`Imagen eliminada`, { blobName });
    return true;
  } catch (error) {
    logger.error('Error eliminando imagen de Blob Storage', error, {
      operation: 'deleteImage',
      url,
    });
    return false;
  }
}

module.exports = {
  uploadImage,
  deleteImage,
  getContainerClient,
  validateFileUpload,
  MAX_IMAGE_SIZE,
  MAX_AUDIO_SIZE,
  ALLOWED_EXTENSIONS,
};
