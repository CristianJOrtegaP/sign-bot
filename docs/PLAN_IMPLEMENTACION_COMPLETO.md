# 🎯 PLAN COMPLETO: Fixes Críticos + Arquitectura Flexible

## Estrategia de Implementación

Este plan combina:
1. **Fixes críticos** que bloquean producción (Race conditions, idempotencia)
2. **Arquitectura flexible** (Form-Filling State Machine)

**Filosofía:** Arreglar primero los cimientos (concurrencia, consistencia) antes de construir la nueva arquitectura encima.

---

# FASE 1: FIXES CRÍTICOS (BLOQUEANTES)

## ⏱️ Duración Estimada: 3-5 días
## 🎯 Objetivo: Sistema estable en producción

### 1.1 Optimistic Locking en updateSession (CRÍTICO)

**Prioridad:** 🔴 URGENTE
**Impacto:** Elimina race conditions en actualizaciones de estado
**Archivos:** `bot/repositories/SesionRepository.js`

#### Implementación:

```javascript
// bot/repositories/SesionRepository.js

async updateSession(
    telefono,
    estadoCodigo,
    datosTemp = null,
    equipoIdTemp = null,
    origenAccion = ORIGEN_ACCION.BOT,
    comentario = null,
    reporteIdTemp = null,
    expectedVersion = null  // ← NUEVO: Versión esperada para optimistic locking
) {
    const sesionId = this._getSesionId(telefono);
    const estadoId = getEstadoId(estadoCodigo);
    const datosJson = datosTemp ? JSON.stringify(datosTemp) : null;

    try {
        const pool = await connectionPool.getPool();

        let query;
        let request = pool.request()
            .input('sesionId', sql.UniqueIdentifier, sesionId)
            .input('estadoId', sql.Int, estadoId)
            .input('datosTemp', sql.NVarChar(sql.MAX), datosJson)
            .input('equipoIdTemp', sql.UniqueIdentifier, equipoIdTemp)
            .input('reporteIdTemp', sql.UniqueIdentifier, reporteIdTemp);

        // Si tenemos expectedVersion, hacer UPDATE condicional
        if (expectedVersion !== null) {
            request.input('expectedVersion', sql.Int, expectedVersion);

            query = `
                UPDATE SesionesChat
                SET EstadoId = @estadoId,
                    DatosTemp = @datosTemp,
                    EquipoIdTemp = @equipoIdTemp,
                    ReporteIdTemp = @reporteIdTemp,
                    FechaUltimaModificacion = GETUTCDATE(),
                    Version = Version + 1  -- ← Incrementar versión
                WHERE SesionId = @sesionId
                  AND Version = @expectedVersion;  -- ← Solo actualizar si versión coincide

                SELECT @@ROWCOUNT AS RowsAffected;
            `;
        } else {
            // Sin optimistic locking (para compatibilidad con código legacy)
            query = `
                UPDATE SesionesChat
                SET EstadoId = @estadoId,
                    DatosTemp = @datosTemp,
                    EquipoIdTemp = @equipoIdTemp,
                    ReporteIdTemp = @reporteIdTemp,
                    FechaUltimaModificacion = GETUTCDATE(),
                    Version = Version + 1
                WHERE SesionId = @sesionId;

                SELECT @@ROWCOUNT AS RowsAffected;
            `;
        }

        const result = await request.query(query);

        // Verificar si se actualizó
        if (expectedVersion !== null && result.recordset[0].RowsAffected === 0) {
            // Versión cambió entre lectura y escritura - otro webhook ganó
            throw new ConcurrencyError(
                `Estado cambió durante actualización. Expected version: ${expectedVersion}`,
                { telefono, estadoCodigo, expectedVersion }
            );
        }

        // Guardar en historial
        await this._saveToHistorial(
            sesionId,
            estadoId,
            origenAccion,
            comentario,
            pool
        );

        // Invalidar caché
        this._invalidateCache(telefono);

        logger.info(`[SesionRepo] updateSession exitoso`, {
            telefono,
            estadoCodigo,
            version: expectedVersion !== null ? expectedVersion + 1 : 'sin_lock'
        });

        return true;

    } catch (error) {
        if (error instanceof ConcurrencyError) {
            throw error;  // Re-lanzar para manejo específico
        }

        logger.error('[SesionRepo] Error en updateSession', error, {
            telefono,
            estadoCodigo
        });
        throw new DatabaseError('Error actualizando sesión', { cause: error });
    }
}

/**
 * Obtiene sesión con versión para optimistic locking
 */
async getSessionWithVersion(telefono) {
    const session = await this.getSessionFresh(telefono);

    if (!session) {
        return null;
    }

    // Agregar campo version si no existe
    if (typeof session.Version === 'undefined') {
        session.Version = 0;  // Default para sesiones antiguas
    }

    return session;
}
```

#### Crear error personalizado:

```javascript
// core/errors/ConcurrencyError.js (NUEVO)

const AppError = require('./AppError');

class ConcurrencyError extends AppError {
    constructor(message, details = {}) {
        super(message, 409, 'CONCURRENCY_ERROR', details);
        this.name = 'ConcurrencyError';
        this.isRetryable = true;  // Se puede reintentar
    }
}

module.exports = ConcurrencyError;
```

#### Actualizar schema de BD:

```sql
-- sql-scripts/migrations/add_version_column.sql

-- Agregar columna Version a SesionesChat
ALTER TABLE SesionesChat
ADD Version INT NOT NULL DEFAULT 0;

-- Crear índice para performance
CREATE INDEX IDX_SesionesChat_Version
ON SesionesChat(SesionId, Version);

-- Trigger para auto-incrementar (opcional, ya lo hacemos en código)
-- Solo si prefieres que BD lo maneje automáticamente
```

#### Integrar en messageHandler:

```javascript
// bot/controllers/messageHandler.js

async function handleText(from, text, context) {
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        try {
            // Obtener sesión CON versión
            const session = await db.getSessionWithVersion(from);
            const currentVersion = session.Version;

            // ... procesar mensaje ...

            // Actualizar con optimistic locking
            await db.updateSession(
                from,
                nuevoEstado,
                datosTemp,
                equipoId,
                ORIGEN_ACCION.BOT,
                'Comentario',
                null,
                currentVersion  // ← Pasar versión esperada
            );

            break;  // Éxito, salir del loop

        } catch (error) {
            if (error instanceof ConcurrencyError && retries < maxRetries - 1) {
                // Esperar tiempo exponencial + jitter
                const delay = Math.pow(2, retries) * 100 + Math.random() * 100;
                await new Promise(resolve => setTimeout(resolve, delay));
                retries++;
                context.log(`[ConcurrencyRetry] Intento ${retries}/${maxRetries}`);
            } else {
                throw error;  // Re-lanzar si ya no hay más reintentos
            }
        }
    }
}
```

#### Checklist:
- [ ] Agregar columna `Version INT` a tabla `SesionesChat`
- [ ] Crear `ConcurrencyError.js`
- [ ] Modificar `updateSession()` con parámetro `expectedVersion`
- [ ] Crear `getSessionWithVersion()`
- [ ] Integrar retry logic en `messageHandler.js`
- [ ] Testear con 2 mensajes simultáneos del mismo usuario
- [ ] Verificar logs: debe mostrar `ConcurrencyRetry` cuando hay conflicto

---

### 1.2 Deduplicación Idempotente (CRÍTICO)

**Prioridad:** 🔴 URGENTE
**Impacto:** Garantiza que mensajes duplicados se manejen correctamente
**Archivos:** `api-whatsapp-webhook/index.js`, `core/services/storage/databaseService.js`

#### Implementación:

```javascript
// api-whatsapp-webhook/index.js

/**
 * Verifica y registra mensaje de forma atómica
 * GARANTIZA idempotencia: mismo mensaje procesado múltiples veces = mismo resultado
 */
async function checkAndRegisterMessage(message, log, logWarn) {
    const messageId = message.id;
    const from = message.from;
    const timestamp = message.timestamp;

    try {
        // Usar MERGE para operación atómica (insert-if-not-exists)
        const result = await db.registerMessageAtomic(
            messageId,
            from,
            timestamp,
            JSON.stringify(message)
        );

        return {
            isDuplicate: !result.isNew,
            isNew: result.isNew,
            previouslyProcessed: result.previouslyProcessed,
            firstSeenAt: result.firstSeenAt
        };

    } catch (error) {
        logWarn(`Error verificando duplicado ${messageId}: ${error.message}`);

        // En caso de error, PERMITIR procesamiento pero marcar
        // Mejor procesar mensaje duplicado que perderlo
        return {
            isDuplicate: false,
            isNew: true,
            error: error.message,
            fallback: true
        };
    }
}

// Usar la nueva función
const dedupResult = await checkAndRegisterMessage(message, log, logWarn);

if (dedupResult.isDuplicate) {
    // Mensaje ya fue procesado, retornar respuesta cacheada
    log(`✓ Mensaje duplicado ${message.id}, ya procesado anteriormente`);

    // Devolver siempre 200 OK (Meta no debe reintentar)
    context.res = createOkResponse(correlationId);
    return;
}

// Si es nuevo, procesar normalmente
log(`→ Mensaje nuevo ${message.id}, procesando...`);
```

#### Implementar en databaseService:

```javascript
// core/services/storage/databaseService.js

/**
 * Registra mensaje de forma atómica usando MERGE
 * Garantiza que solo se procese una vez
 */
async function registerMessageAtomic(messageId, telefono, timestamp, payload) {
    const pool = await connectionPool.getPool();

    try {
        const result = await pool.request()
            .input('messageId', sql.NVarChar(255), messageId)
            .input('telefono', sql.NVarChar(20), telefono)
            .input('timestamp', sql.BigInt, timestamp)
            .input('payload', sql.NVarChar(sql.MAX), payload)
            .query(`
                DECLARE @isNew BIT = 0;
                DECLARE @firstSeenAt DATETIME2;

                MERGE MensajesProcesados AS target
                USING (
                    SELECT @messageId AS MessageId,
                           @telefono AS Telefono,
                           @timestamp AS Timestamp,
                           @payload AS Payload
                ) AS source
                ON target.MessageId = source.MessageId

                WHEN NOT MATCHED THEN
                    INSERT (MessageId, Telefono, Timestamp, Payload, FechaProceso, Procesado)
                    VALUES (source.MessageId, source.Telefono, source.Timestamp,
                            source.Payload, GETUTCDATE(), 1)

                WHEN MATCHED THEN
                    UPDATE SET UltimoIntento = GETUTCDATE(),
                               Reintentos = Reintentos + 1;

                -- Determinar si es nuevo
                IF @@ROWCOUNT > 0 AND EXISTS (
                    SELECT 1 FROM MensajesProcesados
                    WHERE MessageId = @messageId AND Procesado = 1
                )
                BEGIN
                    SET @isNew = 0;  -- Ya existía
                END
                ELSE
                BEGIN
                    SET @isNew = 1;  -- Recién insertado
                END

                -- Obtener fecha de primer procesamiento
                SELECT @firstSeenAt = FechaProceso
                FROM MensajesProcesados
                WHERE MessageId = @messageId;

                SELECT @isNew AS IsNew,
                       @firstSeenAt AS FirstSeenAt,
                       Procesado AS PreviouslyProcessed,
                       Reintentos
                FROM MensajesProcesados
                WHERE MessageId = @messageId;
            `);

        const record = result.recordset[0];

        return {
            isNew: record.IsNew === 1,
            previouslyProcessed: record.PreviouslyProcessed === 1,
            firstSeenAt: record.FirstSeenAt,
            retries: record.Reintentos
        };

    } catch (error) {
        logger.error('[DB] Error en registerMessageAtomic', error, { messageId });
        throw new DatabaseError('Error registrando mensaje', { cause: error });
    }
}

module.exports = {
    // ... funciones existentes ...
    registerMessageAtomic
};
```

#### Crear tabla si no existe:

```sql
-- sql-scripts/migrations/create_mensajes_procesados.sql

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MensajesProcesados')
BEGIN
    CREATE TABLE MensajesProcesados (
        MessageId NVARCHAR(255) PRIMARY KEY,
        Telefono NVARCHAR(20) NOT NULL,
        Timestamp BIGINT NOT NULL,
        Payload NVARCHAR(MAX) NULL,
        FechaProceso DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UltimoIntento DATETIME2 NULL,
        Reintentos INT NOT NULL DEFAULT 0,
        Procesado BIT NOT NULL DEFAULT 0,

        INDEX IDX_Telefono_Timestamp (Telefono, Timestamp),
        INDEX IDX_FechaProceso (FechaProceso)
    );
END;

-- Cleanup job (opcional): eliminar mensajes > 7 días
-- Ejecutar como Timer Function
/*
DELETE FROM MensajesProcesados
WHERE FechaProceso < DATEADD(DAY, -7, GETUTCDATE());
*/
```

#### Checklist:
- [ ] Crear tabla `MensajesProcesados` con script SQL
- [ ] Implementar `registerMessageAtomic()` en `databaseService.js`
- [ ] Reemplazar `checkDuplicates()` con `checkAndRegisterMessage()`
- [ ] Testear enviando el mismo mensaje 3 veces seguidas
- [ ] Verificar que solo se procesa 1 vez
- [ ] Verificar que las otras 2 retornan 200 OK sin error

---

### 1.3 Timeouts Explícitos en IA (CRÍTICO)

**Prioridad:** 🔴 URGENTE
**Impacto:** Previene bloqueos de 60+ segundos
**Archivos:** `core/services/ai/intentService.js`, `bot/controllers/messageHandler.js`

#### Implementación:

```javascript
// core/utils/promises.js (NUEVO)

/**
 * Ejecuta promesa con timeout
 * @param {Promise} promise - Promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {string} errorMsg - Mensaje de error personalizado
 * @returns {Promise} Promesa con timeout
 */
async function withTimeout(promise, timeoutMs, errorMsg = 'Operación timeout') {
    let timeoutHandle;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`${errorMsg} (${timeoutMs}ms)`));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutHandle);
        return result;
    } catch (error) {
        clearTimeout(timeoutHandle);
        throw error;
    }
}

/**
 * Ejecuta promesa con timeout y fallback
 */
async function withTimeoutAndFallback(promise, timeoutMs, fallbackValue, context) {
    try {
        return await withTimeout(promise, timeoutMs);
    } catch (error) {
        if (error.message.includes('timeout')) {
            context?.log?.warn?.(`Timeout en operación, usando fallback`, { error: error.message });
            return fallbackValue;
        }
        throw error;
    }
}

module.exports = {
    withTimeout,
    withTimeoutAndFallback
};
```

#### Aplicar en intentService:

```javascript
// core/services/ai/intentService.js

const { withTimeoutAndFallback } = require('../../utils/promises');

async function detectIntent(text, context = {}) {
    const log = context.log || console.log;

    // 1. Cache (0.1ms)
    const cached = cache.get(text);
    if (cached) {
        log('[Intent] Cache hit');
        return cached;
    }

    // 2. Regex (1ms)
    const regexIntent = detectIntentByRegex(text);
    if (regexIntent) {
        cache.set(text, regexIntent);
        return regexIntent;
    }

    // 3. IA con timeout de 3 segundos
    const aiResult = await withTimeoutAndFallback(
        aiService.detectIntent(text),
        3000,  // 3 segundos máximo
        { intent: 'UNKNOWN', confidence: 0 },  // Fallback
        context
    );

    if (aiResult.intent !== 'UNKNOWN') {
        cache.set(text, aiResult.intent);
        return aiResult.intent;
    }

    return 'UNKNOWN';
}

async function extractStructuredData(text, tipoReporte, context = {}) {
    const timeout = tipoReporte === TIPO_REPORTE.VEHICULO ? 4000 : 3000;

    const result = await withTimeoutAndFallback(
        aiService.extractData(text, tipoReporte),
        timeout,
        null,  // Fallback: no data extracted
        context
    );

    return result;
}
```

#### Aplicar en messageHandler:

```javascript
// bot/controllers/messageHandler.js

const { withTimeout } = require('../../core/utils/promises');

async function handleText(from, text, context) {
    // ...

    // Detección de intención con timeout
    const detectedIntentResult = await withTimeout(
        intent.detectIntent(text, context),
        5000,  // 5 segundos total (incluye retries de IA)
        'Timeout detectando intención'
    ).catch(error => {
        context.log.warn(`Timeout en detectIntent, usando UNKNOWN`, { error: error.message });
        return { intent: 'UNKNOWN', confidence: 0 };
    });

    // ...
}
```

#### Checklist:
- [ ] Crear `core/utils/promises.js` con `withTimeout()`
- [ ] Aplicar timeout en `detectIntent()` (3s)
- [ ] Aplicar timeout en `extractStructuredData()` (4s)
- [ ] Aplicar timeout en `handleText()` (5s total)
- [ ] Testear con mock de IA que tarda 10 segundos
- [ ] Verificar que falla con fallback, no bloquea

---

### 1.4 Circuit Breaker Fix (HALF_OPEN Recovery)

**Prioridad:** 🟡 ALTA
**Impacto:** Mejora recuperación de servicios externos
**Archivos:** `core/services/infrastructure/circuitBreaker.js`

#### Implementación:

```javascript
// core/services/infrastructure/circuitBreaker.js

recordFailure(error) {
    this.failures++;
    this.lastError = error;
    this.lastFailureTime = Date.now();

    logger.warn(`[CircuitBreaker:${this.name}] Failure recorded`, {
        failures: this.failures,
        state: this.state,
        error: error.message
    });

    // NUEVO: Si estamos en HALF_OPEN y falla, volver a OPEN inmediatamente
    if (this.state === STATES.HALF_OPEN) {
        logger.warn(`[CircuitBreaker:${this.name}] Failure in HALF_OPEN, going back to OPEN`);
        this._transitionTo(STATES.OPEN);
        return;
    }

    // Si estamos CLOSED, verificar si debemos abrir
    if (this.state === STATES.CLOSED) {
        if (this._shouldOpen()) {
            this._transitionTo(STATES.OPEN);
        }
    }
}

recordSuccess() {
    this.successes++;
    this.failures = 0;  // Reset failures
    this.lastError = null;

    logger.info(`[CircuitBreaker:${this.name}] Success recorded`, {
        successes: this.successes,
        state: this.state
    });

    // Si estamos en HALF_OPEN y alcanzamos threshold, cerrar
    if (this.state === STATES.HALF_OPEN) {
        if (this.successes >= this.config.successThreshold) {
            logger.info(`[CircuitBreaker:${this.name}] Enough successes in HALF_OPEN, closing`);
            this._transitionTo(STATES.CLOSED);
            this.successes = 0;  // Reset counter
        }
    }
}

// Agregar método para obtener estado del circuit
getState() {
    return {
        name: this.name,
        state: this.state,
        failures: this.failures,
        successes: this.successes,
        lastError: this.lastError?.message || null,
        lastFailureTime: this.lastFailureTime,
        isOpen: this.state === STATES.OPEN
    };
}
```

#### Checklist:
- [ ] Modificar `recordFailure()` para detectar HALF_OPEN
- [ ] Modificar `recordSuccess()` para reset correcto
- [ ] Agregar `getState()` para observabilidad
- [ ] Testear manualmente: forzar fallo en HALF_OPEN
- [ ] Verificar logs: debe mostrar "going back to OPEN"

---

### 1.5 Cleanup de Promise.all sin Verificación

**Prioridad:** 🟡 MEDIA
**Impacto:** Mejor manejo de errores
**Archivos:** `bot/controllers/messageHandler.js`

#### Implementación:

```javascript
// bot/controllers/messageHandler.js

// ANTES:
const [, session] = await Promise.all([
    db.saveMessage(...),
    db.getSession(from)
]);

// DESPUÉS:
const [saveResult, session] = await Promise.allSettled([
    db.saveMessage(from, TIPO_MENSAJE.USUARIO, text, TIPO_CONTENIDO.TEXTO, messageId),
    db.getSession(from)
]);

// Verificar resultado de saveMessage
if (saveResult.status === 'rejected') {
    const error = saveResult.reason;

    // Si es error de duplicado (constraint violation), continuar
    if (error.message?.includes('UNIQUE KEY') || error.code === 'DUPLICATE_KEY') {
        context.log.warn(`Mensaje duplicado en saveMessage: ${messageId}`);
    } else {
        // Error real, loggear y decidir si continuar o rechazar
        context.log.error(`Error guardando mensaje: ${error.message}`);
        // Para producción: continuar procesando (mejor responder que perder mensaje)
        // Para desarrollo: throw error (para detectar bugs)
    }
}

// Verificar sesión
if (session.status === 'rejected') {
    throw new Error(`Error obteniendo sesión: ${session.reason.message}`);
}

const sessionData = session.value;
```

#### Checklist:
- [ ] Cambiar `Promise.all` por `Promise.allSettled` en messageHandler
- [ ] Verificar status de cada promesa
- [ ] Agregar logs para errores
- [ ] Decidir política: continuar o rechazar según tipo de error

---

# FASE 2: ARQUITECTURA FLEXIBLE (FORM-FILLING)

## ⏱️ Duración Estimada: 5-7 días
## 🎯 Objetivo: Conversaciones naturales y flexibles

### 2.1 Migración de Base de Datos

**Archivos:** `sql-scripts/migrations/`

#### Script SQL:

```sql
-- sql-scripts/migrations/002_add_flexible_flow_support.sql

-- 1. Agregar columna Version a SesionesChat (si no se hizo en Fase 1)
IF NOT EXISTS (SELECT * FROM sys.columns
               WHERE object_id = OBJECT_ID('SesionesChat')
               AND name = 'Version')
BEGIN
    ALTER TABLE SesionesChat
    ADD Version INT NOT NULL DEFAULT 0;

    CREATE INDEX IDX_SesionesChat_Version
    ON SesionesChat(SesionId, Version);
END;

-- 2. Agregar nuevos estados para flujos flexibles
INSERT INTO CatEstadoSesion (Codigo, Nombre, Descripcion)
VALUES
    ('REFRIGERADOR_ACTIVO', 'Refrigerador - Recolectando Datos', 'Usuario en flujo flexible de refrigerador'),
    ('VEHICULO_ACTIVO', 'Vehículo - Recolectando Datos', 'Usuario en flujo flexible de vehículo');

-- 3. Actualizar DatosTemp para soportar estructura de campos
-- (No es necesario cambio de schema, ya es NVARCHAR(MAX) JSON)

-- 4. Crear tabla de auditoría de extracción de campos (opcional)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CamposExtraidosLog')
BEGIN
    CREATE TABLE CamposExtraidosLog (
        LogId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        SesionId UNIQUEIDENTIFIER NOT NULL,
        Campo NVARCHAR(50) NOT NULL,
        ValorExtraido NVARCHAR(MAX) NULL,
        Fuente NVARCHAR(20) NOT NULL,  -- 'regex', 'ia', 'manual'
        Confianza DECIMAL(3,2) NULL,
        Validado BIT NOT NULL DEFAULT 0,
        FechaExtraccion DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        FOREIGN KEY (SesionId) REFERENCES SesionesChat(SesionId),
        INDEX IDX_SesionId (SesionId),
        INDEX IDX_FechaExtraccion (FechaExtraccion)
    );
END;

-- 5. View para debugging: ver progreso de campos por sesión
CREATE OR ALTER VIEW vw_ProgresoSesiones AS
SELECT
    s.SesionId,
    s.Telefono,
    e.Codigo AS EstadoActual,
    s.DatosTemp,
    s.Version,
    s.FechaCreacion,
    s.FechaUltimaModificacion,
    DATEDIFF(MINUTE, s.FechaUltimaModificacion, GETUTCDATE()) AS MinutosInactivo,
    -- Extraer campos del JSON (SQL Server 2016+)
    JSON_VALUE(s.DatosTemp, '$.tipoReporte') AS TipoReporte,
    JSON_VALUE(s.DatosTemp, '$.camposRequeridos.codigoSAP.completo') AS SAP_Completo,
    JSON_VALUE(s.DatosTemp, '$.camposRequeridos.descripcion.completo') AS Descripcion_Completo,
    JSON_VALUE(s.DatosTemp, '$.camposRequeridos.ubicacion.completo') AS Ubicacion_Completo
FROM SesionesChat s
JOIN CatEstadoSesion e ON s.EstadoId = e.EstadoId
WHERE e.Codigo IN ('REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO');
```

#### Checklist:
- [ ] Ejecutar script SQL en BD de desarrollo
- [ ] Verificar que nuevos estados existen en `CatEstadoSesion`
- [ ] Verificar columna `Version` agregada
- [ ] Crear tabla `CamposExtraidosLog` (opcional)
- [ ] Testear view `vw_ProgresoSesiones`

---

### 2.2 Core: Field Extractor

**Archivo:** `bot/services/fieldExtractor.js` (NUEVO)

#### Implementación completa:

```javascript
// bot/services/fieldExtractor.js

const aiService = require('../../core/services/ai/aiService');
const { validateSAPCode, validateEmployeeNumber } = require('../../core/utils/helpers');
const { TIPO_REPORTE } = require('../constants/sessionStates');
const { logger } = require('../../core/services/infrastructure/errorHandler');

/**
 * Extrae TODOS los campos posibles de un mensaje de texto
 * Usa múltiples técnicas: Regex, IA, contexto previo
 *
 * @param {string} text - Texto del mensaje del usuario
 * @param {string} tipoReporte - REFRIGERADOR o VEHICULO
 * @param {Object} session - Sesión actual (para contexto)
 * @param {Object} context - Contexto de Azure Functions
 * @returns {Object} Campos extraídos con metadata
 */
async function extractAllFields(text, tipoReporte, session, context) {
    const campos = {};
    const log = context?.log || console.log;

    log(`[FieldExtractor] Extrayendo campos de: "${text.substring(0, 50)}..."`);

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        // ========== REFRIGERADOR ==========

        // 1. Extraer código SAP (Regex primero, más rápido)
        const sapRegex = /\b([A-Z0-9]{5,10})\b/i;
        const sapMatch = text.match(sapRegex);

        if (sapMatch) {
            const validation = validateSAPCode(sapMatch[1]);
            if (validation.valid) {
                campos.codigoSAP = {
                    valor: validation.cleaned,
                    fuente: 'regex',
                    confianza: 0.9,
                    textoOriginal: sapMatch[1]
                };
                log(`[FieldExtractor] ✓ SAP detectado: ${validation.cleaned}`);
            }
        }

        // 2. Detectar confirmación de equipo
        const confirmacionPatterns = [
            /^(s[ií]|si|yes|ok|correcto|exacto|confirmo|afirmativo|dale|va|claro)$/i,
            /^(es\s+correcto|está\s+bien|todo\s+bien)$/i
        ];

        const esConfirmacion = confirmacionPatterns.some(pattern => pattern.test(text.trim()));
        if (esConfirmacion) {
            campos.equipoConfirmado = {
                valor: true,
                fuente: 'regex',
                confianza: 1.0
            };
            log(`[FieldExtractor] ✓ Confirmación detectada`);
        }

        // 3. Detectar rechazo/corrección
        const rechazoPatterns = [
            /^(no|nop|nope|incorrecto|mal|error|cambiar|corregir|otro)$/i
        ];

        const esRechazo = rechazoPatterns.some(pattern => pattern.test(text.trim()));
        if (esRechazo) {
            campos.equipoConfirmado = {
                valor: false,
                fuente: 'regex',
                confianza: 1.0
            };
            log(`[FieldExtractor] ✓ Rechazo detectado`);
        }

        // 4. Extraer descripción del problema (IA)
        // Solo si el mensaje no es un código SAP solo o confirmación
        if (text.length > 10 && !esConfirmacion && !esRechazo) {
            try {
                const descripcionIA = await aiService.extractProblema(text);
                if (descripcionIA && descripcionIA.length >= 5) {
                    campos.descripcion = {
                        valor: descripcionIA,
                        fuente: 'ia',
                        confianza: 0.8,
                        textoOriginal: text
                    };
                    log(`[FieldExtractor] ✓ Descripción extraída: "${descripcionIA}"`);
                }
            } catch (error) {
                log(`[FieldExtractor] Error extrayendo descripción: ${error.message}`);
            }
        }
    }

    if (tipoReporte === TIPO_REPORTE.VEHICULO) {
        // ========== VEHICULO ==========

        // 1. Extraer número de empleado (4-6 dígitos)
        const empleadoRegex = /\b(\d{4,6})\b/;
        const empleadoMatch = text.match(empleadoRegex);

        if (empleadoMatch) {
            const validation = validateEmployeeNumber(empleadoMatch[1]);
            if (validation.valid) {
                campos.numeroEmpleado = {
                    valor: validation.cleaned,
                    fuente: 'regex',
                    confianza: 0.85,
                    textoOriginal: empleadoMatch[1]
                };
                log(`[FieldExtractor] ✓ Empleado detectado: ${validation.cleaned}`);
            }
        }

        // 2. Extraer código SAP vehículo
        const sapRegex = /\b([A-Z0-9]{5,10})\b/i;
        const sapMatch = text.match(sapRegex);

        if (sapMatch && !campos.numeroEmpleado) {  // Evitar confusión con empleado
            const validation = validateSAPCode(sapMatch[1]);
            if (validation.valid) {
                campos.codigoSAP = {
                    valor: validation.cleaned,
                    fuente: 'regex',
                    confianza: 0.9,
                    textoOriginal: sapMatch[1]
                };
                log(`[FieldExtractor] ✓ SAP vehículo detectado: ${validation.cleaned}`);
            }
        }

        // 3. Extraer descripción del problema (IA)
        if (text.length > 10) {
            try {
                const descripcionIA = await aiService.extractProblema(text);
                if (descripcionIA && descripcionIA.length >= 5) {
                    campos.descripcion = {
                        valor: descripcionIA,
                        fuente: 'ia',
                        confianza: 0.8,
                        textoOriginal: text
                    };
                    log(`[FieldExtractor] ✓ Descripción extraída: "${descripcionIA}"`);
                }
            } catch (error) {
                log(`[FieldExtractor] Error extrayendo descripción: ${error.message}`);
            }
        }

        // Nota: ubicación se maneja en handler separado (mensaje tipo location)
    }

    log(`[FieldExtractor] Total campos extraídos: ${Object.keys(campos).length}`);
    return campos;
}

/**
 * Extrae campos de una imagen usando AI Vision / OCR
 */
async function extractFieldsFromImage(imageUrl, tipoReporte, context) {
    const campos = {};
    const log = context?.log || console.log;

    try {
        log(`[FieldExtractor] Extrayendo de imagen: ${imageUrl}`);

        // Usar AI Vision para extraer texto de imagen
        const ocrResult = await aiService.analyzeImage(imageUrl, {
            extractText: true,
            extractObjects: true
        });

        if (ocrResult.text) {
            // Analizar texto extraído de imagen
            const textFields = await extractAllFields(
                ocrResult.text,
                tipoReporte,
                null,
                context
            );

            // Merge campos con metadata de que vienen de imagen
            for (const [key, value] of Object.entries(textFields)) {
                campos[key] = {
                    ...value,
                    fuente: 'vision',
                    imageUrl
                };
            }
        }

        return campos;

    } catch (error) {
        log(`[FieldExtractor] Error extrayendo de imagen: ${error.message}`);
        return {};
    }
}

/**
 * Extrae ubicación de mensaje de tipo location
 */
function extractLocationField(locationMessage) {
    if (!locationMessage.latitude || !locationMessage.longitude) {
        return null;
    }

    return {
        ubicacion: {
            valor: {
                latitud: locationMessage.latitude,
                longitud: locationMessage.longitude,
                direccion: locationMessage.address || null
            },
            fuente: 'whatsapp',
            confianza: 1.0
        }
    };
}

module.exports = {
    extractAllFields,
    extractFieldsFromImage,
    extractLocationField
};
```

#### Checklist:
- [ ] Crear archivo `bot/services/fieldExtractor.js`
- [ ] Implementar `extractAllFields()`
- [ ] Implementar `extractFieldsFromImage()` (opcional inicialmente)
- [ ] Implementar `extractLocationField()`
- [ ] Agregar tests unitarios para cada función
- [ ] Testear con mensajes reales de usuarios

---

### 2.3 Core: Field Manager

**Archivo:** `bot/services/fieldManager.js` (NUEVO)

Ver implementación completa en archivo adjunto (demasiado largo para incluir aquí).

**Funcionalidades clave:**
- `initializeCamposRequeridos(tipoReporte)` - Crea estructura inicial
- `mergeCampos(camposActuales, camposExtraidos)` - Merge inteligente
- `validarCampo(nombreCampo, valor, tipoReporte)` - Validaciones de negocio
- `getCamposFaltantes(campos)` - Detecta qué falta
- `getProgresoCompletitud(campos)` - % de progreso
- `estaCompleto(campos)` - Verifica si puede crear reporte

#### Checklist:
- [ ] Crear archivo `bot/services/fieldManager.js`
- [ ] Implementar todas las funciones core
- [ ] Agregar tests unitarios
- [ ] Verificar validaciones contra BD (equipos, empleados)

---

### 2.4 Flujo Flexible: Manager

**Archivo:** `bot/controllers/flows/flexibleFlowManager.js` (NUEVO)

Ver código completo en `docs/PROPUESTA_FLUJO_FLEXIBLE.md` sección 5.

**Funcionalidades clave:**
- `processFlexibleFlow()` - Orquestador principal
- `pedirSiguienteCampo()` - Mensaje contextual
- `crearReporteRefrigerador()` - Crea reporte cuando está completo
- `crearReporteVehiculo()` - Crea reporte vehículo

#### Checklist:
- [ ] Crear archivo `bot/controllers/flows/flexibleFlowManager.js`
- [ ] Implementar `processFlexibleFlow()`
- [ ] Implementar `pedirSiguienteCampo()` con mensajes contextuales
- [ ] Implementar `crearReporteRefrigerador()`
- [ ] Implementar `crearReporteVehiculo()`
- [ ] Integrar con `fieldExtractor` y `fieldManager`

---

### 2.5 Integración con messageHandler

**Archivo:** `bot/controllers/messageHandler.js`

```javascript
// bot/controllers/messageHandler.js

const flexibleFlowManager = require('./flows/flexibleFlowManager');
const fieldExtractor = require('../services/fieldExtractor');

// Feature flag para activar/desactivar flujo flexible
const FLEXIBLE_FLOWS_ENABLED = process.env.FLEXIBLE_FLOWS_ENABLED === 'true';

async function handleText(from, text, context, messageId) {
    // ... código existente de validación, deduplicación ...

    // Obtener sesión con versión (optimistic locking)
    const session = await db.getSessionWithVersion(from);
    const currentVersion = session.Version;

    // ========== FLUJOS FLEXIBLES ==========
    if (FLEXIBLE_FLOWS_ENABLED) {
        // Si está en flujo activo flexible, procesar
        if (['REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO'].includes(session.Estado)) {
            const handled = await flexibleFlowManager.processFlexibleFlow(
                from,
                text,
                session,
                context
            );

            if (handled) {
                return;
            }
        }

        // Si está en estado terminal, detectar intención e iniciar flujo flexible
        if (esEstadoTerminal(session.Estado)) {
            const detectedIntent = await intent.detectIntent(text, context);

            if (detectedIntent === 'REFRIGERADOR' || detectedIntent === 'VEHICULO') {
                await iniciarFlujoFlexible(from, detectedIntent, text, context);
                return;
            }
        }
    }

    // ========== FLUJOS LEGACY (Fallback) ==========
    // Encuestas, consultas, estados antiguos
    const handled = await FlowManager.processSessionState(from, text, session, context);

    if (!handled) {
        // No se pudo procesar, enviar mensaje de ayuda
        await whatsapp.sendText(from, MSG.GENERAL.HELP);
    }
}

/**
 * Inicia flujo flexible con datos pre-extraídos
 */
async function iniciarFlujoFlexible(from, tipoReporte, mensajeInicial, context) {
    context.log(`[FlexibleFlow] Iniciando flujo ${tipoReporte}`);

    // Inicializar campos requeridos
    const fieldManager = require('../services/fieldManager');
    const camposRequeridos = fieldManager.initializeCamposRequeridos(tipoReporte);

    // Cambiar a estado activo
    const nuevoEstado = tipoReporte === TIPO_REPORTE.REFRIGERADOR
        ? ESTADO.REFRIGERADOR_ACTIVO
        : ESTADO.VEHICULO_ACTIVO;

    await db.updateSession(
        from,
        nuevoEstado,
        {
            tipoReporte,
            camposRequeridos
        },
        null,
        ORIGEN_ACCION.BOT,
        `Flujo flexible ${tipoReporte} iniciado`
    );

    // Procesar el mensaje inicial (puede contener datos)
    const session = await db.getSessionFresh(from);
    await flexibleFlowManager.processFlexibleFlow(from, mensajeInicial, session, context);
}
```

#### Checklist:
- [ ] Agregar feature flag `FLEXIBLE_FLOWS_ENABLED`
- [ ] Modificar `handleText()` para detectar flujos flexibles
- [ ] Implementar `iniciarFlujoFlexible()`
- [ ] Mantener flujos legacy como fallback
- [ ] Testear transición de legacy a flexible

---

### 2.6 Actualizar Estados en BD

```javascript
// bot/constants/sessionStates.js

const ESTADO = {
    // Estados terminales
    INICIO: 'INICIO',
    CANCELADO: 'CANCELADO',
    FINALIZADO: 'FINALIZADO',
    TIMEOUT: 'TIMEOUT',

    // Estados de flujo flexible (NUEVOS)
    REFRIGERADOR_ACTIVO: 'REFRIGERADOR_ACTIVO',
    VEHICULO_ACTIVO: 'VEHICULO_ACTIVO',

    // Estados legacy (mantener para compatibilidad)
    REFRI_ESPERA_SAP: 'REFRI_ESPERA_SAP',
    REFRI_CONFIRMAR_EQUIPO: 'REFRI_CONFIRMAR_EQUIPO',
    REFRI_ESPERA_DESCRIPCION: 'REFRI_ESPERA_DESCRIPCION',
    VEHICULO_ESPERA_EMPLEADO: 'VEHICULO_ESPERA_EMPLEADO',
    VEHICULO_ESPERA_SAP: 'VEHICULO_ESPERA_SAP',
    VEHICULO_ESPERA_DESCRIPCION: 'VEHICULO_ESPERA_DESCRIPCION',
    VEHICULO_ESPERA_UBICACION: 'VEHICULO_ESPERA_UBICACION',
    VEHICULO_CONFIRMAR_DATOS_AI: 'VEHICULO_CONFIRMAR_DATOS_AI',

    // Encuestas (sin cambios)
    ENCUESTA_INVITACION: 'ENCUESTA_INVITACION',
    // ...
};

// Helpers para flujos flexibles
function esEstadoFlexible(estado) {
    return ['REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO'].includes(estado);
}

module.exports = {
    ESTADO,
    esEstadoFlexible,
    // ... exports existentes
};
```

---

### 2.7 Mensajes Contextuales

**Archivo:** `bot/constants/messages.js`

Agregar mensajes dinámicos para flujo flexible:

```javascript
// bot/constants/messages.js

const MSG = {
    // ... mensajes existentes ...

    FLEXIBLE: {
        // Mensajes contextuales según campos completados
        pedirSAP: (tieneDescripcion) => {
            if (tieneDescripcion) {
                return `👍 Entendido, el problema es "${tieneDescripcion.substring(0, 50)}".\n\n` +
                       `📝 ¿Cuál es el código SAP del equipo?`;
            }
            return `📝 ¿Cuál es el código SAP del refrigerador?\n\n` +
                   `Lo encuentras en una etiqueta en el equipo (5-10 caracteres).`;
        },

        confirmarEquipo: (equipo, descripcion) => {
            let msg = `🔍 Encontré este equipo:\n\n` +
                      `📍 Ubicación: ${equipo.Ubicacion}\n` +
                      `🏢 Cliente: ${equipo.ClienteNombre}\n`;

            if (descripcion) {
                msg += `\n📝 Problema: "${descripcion}"\n`;
            }

            msg += `\n¿Es correcto?`;
            return msg;
        },

        pedirDescripcion: (tieneSAP) => {
            if (tieneSAP) {
                return `📝 ¿Qué problema tiene el equipo ${tieneSAP}?`;
            }
            return `📝 ¿Qué problema tiene el equipo?\n\n` +
                   `Descríbelo brevemente (ej: "no enfría", "hace ruido", etc.)`;
        },

        progresoReporte: (progreso) => {
            const porcentaje = Math.round(progreso * 100);
            const barras = Math.round(progreso * 10);
            const barra = '█'.repeat(barras) + '░'.repeat(10 - barras);

            return `📊 Progreso: ${barra} ${porcentaje}%`;
        },

        resumenDatosCapturados: (campos) => {
            let resumen = `📋 Datos capturados hasta ahora:\n\n`;

            if (campos.codigoSAP?.completo) {
                resumen += `✓ Código SAP: ${campos.codigoSAP.valor}\n`;
            }
            if (campos.descripcion?.completo) {
                resumen += `✓ Problema: ${campos.descripcion.valor}\n`;
            }
            if (campos.numeroEmpleado?.completo) {
                resumen += `✓ Empleado: ${campos.numeroEmpleado.valor}\n`;
            }
            if (campos.ubicacion?.completo) {
                resumen += `✓ Ubicación: Recibida\n`;
            }

            return resumen;
        }
    }
};
```

---

### 2.8 Tests de Integración

**Archivo:** `tests/integration/flexibleFlow.test.js` (NUEVO)

```javascript
// tests/integration/flexibleFlow.test.js

const flexibleFlowManager = require('../../bot/controllers/flows/flexibleFlowManager');
const fieldExtractor = require('../../bot/services/fieldExtractor');
const db = require('../../core/services/storage/databaseService');

describe('Flexible Flow Integration Tests', () => {

    test('Usuario da TODO en un mensaje - Refrigerador', async () => {
        const from = '+5218112345678';
        const text = 'Mi refrigerador ABC123 no enfría bien';

        // Iniciar sesión
        await db.updateSession(from, 'REFRIGERADOR_ACTIVO', {
            tipoReporte: 'REFRIGERADOR',
            camposRequeridos: {
                codigoSAP: { valor: null, completo: false },
                equipoConfirmado: { valor: null, completo: false },
                descripcion: { valor: null, completo: false }
            }
        });

        const session = await db.getSession(from);

        // Procesar mensaje
        await flexibleFlowManager.processFlexibleFlow(from, text, session, { log: console.log });

        // Verificar que extrae ambos campos
        const sessionActualizada = await db.getSession(from);
        const datos = JSON.parse(sessionActualizada.DatosTemp);

        expect(datos.camposRequeridos.codigoSAP.completo).toBe(true);
        expect(datos.camposRequeridos.descripcion.completo).toBe(true);
        expect(datos.camposRequeridos.equipoConfirmado.completo).toBe(false);  // Falta confirmar
    });

    test('Usuario da datos en desorden', async () => {
        // Test similar pero con mensajes secuenciales
    });

    test('Manejo de error de validación', async () => {
        // Test con código SAP inválido
    });
});
```

---

# FASE 3: TESTING Y OPTIMIZACIÓN

## ⏱️ Duración Estimada: 2-3 días

### 3.1 Tests Unitarios Completos

**Checklist:**
- [ ] Tests para `fieldExtractor.js` (10+ casos)
- [ ] Tests para `fieldManager.js` (15+ casos)
- [ ] Tests para `flexibleFlowManager.js` (20+ casos)
- [ ] Tests para optimistic locking (concurrencia)
- [ ] Tests para deduplicación idempotente
- [ ] Tests para timeouts

### 3.2 Tests de Carga (Load Testing)

```yaml
# tests/load/flexible-flow-load.yml

config:
  target: 'http://localhost:7071'
  phases:
    - duration: 60
      arrivalRate: 10  # 10 usuarios/segundo
    - duration: 120
      arrivalRate: 50  # Pico de 50 usuarios/segundo
    - duration: 60
      arrivalRate: 10  # Cooldown

scenarios:
  - name: "Flujo completo flexible"
    flow:
      - post:
          url: "/api/whatsapp-webhook"
          json:
            entry: [...]
            # Simular mensaje con todos los datos
      - think: 2
      - post:
          url: "/api/whatsapp-webhook"
          json:
            # Simular confirmación
```

**Ejecutar:**
```bash
npm run test:load
```

### 3.3 Monitoreo y Observabilidad

**Application Insights Queries:**

```kusto
// Query 1: Tasa de éxito de optimistic locking
traces
| where message contains "ConcurrencyRetry"
| summarize Reintentos = count() by bin(timestamp, 5m)
| render timechart

// Query 2: Tiempo promedio de extracción de campos
traces
| where message contains "[FieldExtractor]"
| extend duration = tolong(customDimensions.duration)
| summarize avg(duration), percentile(duration, 95) by bin(timestamp, 1h)

// Query 3: Campos más extraídos por IA vs. Regex
traces
| where message contains "Campo detectado"
| extend campo = tostring(customDimensions.campo), fuente = tostring(customDimensions.fuente)
| summarize count() by campo, fuente
| render barchart

// Query 4: Tasa de completitud de reportes
traces
| where message contains "Reporte creado"
| extend mensajes = tolong(customDimensions.mensajes_intercambiados)
| summarize avg(mensajes), min(mensajes), max(mensajes)
```

---

# FASE 4: ROLLOUT Y MIGRACIÓN

## ⏱️ Duración Estimada: 3-5 días

### 4.1 Feature Flag Rollout

```javascript
// core/config/index.js

module.exports = {
    featureFlags: {
        flexibleFlows: {
            enabled: process.env.FLEXIBLE_FLOWS_ENABLED === 'true',
            rolloutPercentage: parseInt(process.env.FLEXIBLE_FLOWS_ROLLOUT || '0', 10),
            whitelistedUsers: (process.env.FLEXIBLE_FLOWS_WHITELIST || '').split(',').filter(Boolean)
        }
    }
};

// Uso en messageHandler:
function shouldUseFlexibleFlow(telefono) {
    const config = require('../../core/config');

    // Whitelist siempre usa flujo flexible
    if (config.featureFlags.flexibleFlows.whitelistedUsers.includes(telefono)) {
        return true;
    }

    // Feature flag apagado
    if (!config.featureFlags.flexibleFlows.enabled) {
        return false;
    }

    // Rollout por porcentaje (hash consistente)
    const hash = crypto.createHash('md5').update(telefono).digest('hex');
    const userPercentile = parseInt(hash.substring(0, 2), 16) / 255 * 100;

    return userPercentile < config.featureFlags.flexibleFlows.rolloutPercentage;
}
```

### 4.2 Plan de Rollout Gradual

| Fase | Porcentaje | Duración | Criterio de Éxito |
|------|------------|----------|-------------------|
| Canary | 5% | 2 días | Error rate < 1%, p95 latency < 2s |
| Early Adopters | 25% | 3 días | User satisfaction > 80% |
| Majority | 50% | 3 días | Abandonment rate < 10% |
| Full Rollout | 100% | 2 días | Stable for 48h |

### 4.3 Rollback Plan

Si se detectan problemas:

```bash
# 1. Apagar feature flag
az functionapp config appsettings set \
  --name acfixbot-functions \
  --resource-group acfixbot-rg \
  --settings FLEXIBLE_FLOWS_ENABLED=false

# 2. Verificar métricas
# 3. Investigar logs
# 4. Fix en dev
# 5. Re-rollout gradual
```

---

# RESUMEN EJECUTIVO

## Tiempo Total Estimado

| Fase | Duración | Descripción |
|------|----------|-------------|
| Fase 1 | 3-5 días | Fixes críticos (race conditions, optimistic locking) |
| Fase 2 | 5-7 días | Arquitectura flexible completa |
| Fase 3 | 2-3 días | Testing exhaustivo |
| Fase 4 | 3-5 días | Rollout gradual |
| **TOTAL** | **13-20 días** | ~3-4 semanas |

## Dependencias y Orden

```
Fase 1.1 (Optimistic Locking) ────┐
Fase 1.2 (Deduplicación)      ────┤
Fase 1.3 (Timeouts)           ────┼─> Fase 2 (Arquitectura Flexible)
Fase 1.4 (Circuit Breaker)    ────┤
Fase 1.5 (Promise.all)        ────┘
                                   │
                                   ├─> Fase 3 (Testing)
                                   │
                                   └─> Fase 4 (Rollout)
```

## Hitos Clave (Milestones)

- [ ] **M1:** Optimistic locking implementado y testeado (Día 3)
- [ ] **M2:** Todos los fixes críticos completos (Día 5)
- [ ] **M3:** Field Extractor + Manager funcionando (Día 10)
- [ ] **M4:** Flujo flexible end-to-end en dev (Día 12)
- [ ] **M5:** Tests pasando al 100% (Día 15)
- [ ] **M6:** Canary rollout (5%) exitoso (Día 17)
- [ ] **M7:** Full rollout (100%) (Día 20)

## Métricas de Éxito

| Métrica | Baseline (Actual) | Target (Flexible) |
|---------|-------------------|-------------------|
| Mensajes promedio por reporte | 5-7 | 2-4 |
| Tiempo promedio por reporte | 3-5 min | 1-3 min |
| Tasa de abandono | ~20% | <10% |
| Error rate | 2-3% | <1% |
| User satisfaction (NPS) | ? | >80% |
| Race conditions por día | ~5-10 | 0 |

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| IA extrae campos incorrectos | Media | Alto | Validar siempre antes de marcar completo |
| Usuarios confundidos con flujo flexible | Baja | Medio | Mensajes contextuales claros |
| Migración de BD falla | Baja | Alto | Backup antes de migrar + script rollback |
| Performance degradation | Media | Medio | Load testing antes de rollout |
| Rollback necesario en producción | Baja | Alto | Feature flags + canary deployment |

---

# PRÓXIMOS PASOS INMEDIATOS

## ¿Empezamos con Fase 1.1?

Te puedo generar los archivos completos para empezar:

1. `sql-scripts/migrations/001_add_version_column.sql`
2. `core/errors/ConcurrencyError.js`
3. `bot/repositories/SesionRepository.js` (modificado)
4. Tests unitarios para optimistic locking

¿Procedemos? 🚀
