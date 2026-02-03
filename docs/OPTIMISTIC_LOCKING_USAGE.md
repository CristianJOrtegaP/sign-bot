# Optimistic Locking - Guía de Uso

## Resumen

Optimistic Locking previene race conditions cuando múltiples webhooks intentan actualizar la misma sesión simultáneamente.

**Problema anterior:**
```
Webhook 1: Lee sesión (Version=0, Estado=INICIO)
Webhook 2: Lee sesión (Version=0, Estado=INICIO)
Webhook 1: Actualiza a REFRI_ESPERA_SAP
Webhook 2: Actualiza a VEHICULO_ESPERA_EMPLEADO  ❌ Lost update!
```

**Solución con Optimistic Locking:**
```
Webhook 1: Lee sesión (Version=0)
Webhook 2: Lee sesión (Version=0)
Webhook 1: Actualiza con Version=0 → Version=1 ✅
Webhook 2: Intenta actualizar con Version=0 → FALLA (Version ya es 1)
Webhook 2: Reintenta: lee sesión (Version=1), procesa, actualiza con Version=1 → Version=2 ✅
```

---

## Migración de Base de Datos

**Ejecutar ANTES de deployar el código:**

```bash
# En Azure SQL Server o local
sqlcmd -S <server> -d <database> -i sql-scripts/migrations/001_add_version_column.sql
```

Esto agrega:
- Columna `Version INT NOT NULL DEFAULT 0` a `SesionesChat`
- Índice `IX_SesionesChat_Telefono_Version` para performance

---

## Cómo Usar en Código

### Opción 1: Usar `withSessionRetry()` (Recomendado)

El helper más simple para casos comunes:

```javascript
const { withSessionRetry } = require('../../core/utils/retry');
const db = require('../../core/services/storage/databaseService');

// Ejemplo: Actualizar sesión con retry automático
await withSessionRetry(telefono, async (session) => {
    // 'session' incluye session.Version automáticamente

    await db.updateSession(
        telefono,
        ESTADO.REFRI_ESPERA_DESCRIPCION,
        { tipoReporte: 'REFRIGERADOR', codigoSAP: 'ABC123' },
        equipoId,
        ORIGEN_ACCION.BOT,
        'Equipo confirmado',
        null,
        session.Version  // ← Pasar versión aquí
    );
});
```

**Ventajas:**
- Automáticamente lee `session` con versión
- Si falla por `ConcurrencyError`, reintenta hasta 3 veces
- Exponential backoff con jitter (50ms → 100ms → 200ms)

---

### Opción 2: Usar `withRetry()` (Más Control)

Para casos donde necesitas lógica custom:

```javascript
const { withRetry } = require('../../core/utils/retry');
const db = require('../../core/services/storage/databaseService');

await withRetry(
    async () => {
        // Leer sesión con versión
        const session = await db.getSessionWithVersion(telefono);

        // Tu lógica aquí...
        const nuevoEstado = determinarSiguienteEstado(session);

        // Actualizar con versión
        await db.updateSession(
            telefono,
            nuevoEstado,
            datosTemp,
            equipoId,
            ORIGEN_ACCION.USUARIO,
            'Estado actualizado',
            null,
            session.Version  // ← Importante
        );
    },
    {
        maxAttempts: 3,
        operationName: 'updateSessionState',
        onRetry: (attempt, delayMs, error) => {
            context.log(`[Retry] Intento ${attempt + 1}, esperando ${delayMs}ms`);
        }
    }
);
```

---

### Opción 3: Manual (Sin Retry)

Si NO quieres retry automático (ej: en tests):

```javascript
const db = require('../../core/services/storage/databaseService');
const { ConcurrencyError } = require('../../core/errors');

try {
    const session = await db.getSessionWithVersion(telefono);

    await db.updateSession(
        telefono,
        ESTADO.FINALIZADO,
        null,
        null,
        ORIGEN_ACCION.BOT,
        'Reporte creado',
        reporteId,
        session.Version
    );
} catch (error) {
    if (error instanceof ConcurrencyError) {
        // Manejar race condition
        console.log('Otra instancia actualizó la sesión primero');
    }
    throw error;
}
```

---

## Actualizar Código Existente

### ANTES (Sin Optimistic Locking):

```javascript
// messageHandler.js - VULNERABLE a race conditions
const session = await db.getSession(from);

// ... lógica ...

await db.updateSession(
    from,
    ESTADO.REFRI_ESPERA_SAP,
    { tipoReporte: 'REFRIGERADOR' }
);
```

### DESPUÉS (Con Optimistic Locking):

```javascript
// messageHandler.js - PROTEGIDO con retry
const { withSessionRetry } = require('../../core/utils/retry');

await withSessionRetry(from, async (session) => {
    // ... lógica ...

    await db.updateSession(
        from,
        ESTADO.REFRI_ESPERA_SAP,
        { tipoReporte: 'REFRIGERADOR' },
        null,
        ORIGEN_ACCION.BOT,
        'Iniciando flujo refrigerador',
        null,
        session.Version  // ← Agregar este parámetro
    );
});
```

---

## Cuándo Usar Optimistic Locking

### ✅ Usar optimistic locking:

- **Actualizar estado de sesión** cuando se procesa webhook
- **Crear reporte** al finalizar flujo
- **Cancelar sesión** por timeout o comando usuario
- Cualquier operación donde 2+ webhooks pueden llegar **concurrentemente**

### ❌ NO usar (opcional):

- Guardar mensaje en historial (`saveMessage`) - no crítico
- Actualizar última actividad (`updateLastActivity`) - no crítico
- Operaciones de solo lectura (`getSession`, `getMensajes`)

---

## Logs de Diagnóstico

Cuando hay race condition, verás en Application Insights:

```
[ConcurrencyRetry] updateSession(+52XXXXXXXXXX) - Intento 1/3 falló, reintentando en 52ms
  → error: "Concurrency conflict detected for +52XXXXXXXXXX. Expected version: 0."

[ConcurrencyRetry] updateSession(+52XXXXXXXXXX) - Intento 2/3 falló, reintentando en 108ms

✅ Sesión actualizada: +52XXXXXXXXXX -> REFRI_ESPERA_SAP
```

**Qué significa:**
- Otro webhook actualizó la sesión primero
- El sistema reintentó automáticamente
- Segunda tentativa tuvo éxito

**Acción:** Si ves MUCHOS reintentos (>10/min), puede haber problema de sincronización o Meta enviando duplicados.

---

## Métricas de Éxito

Para medir efectividad, monitorear en Application Insights:

```kql
// Tasa de reintentos por optimistic locking
traces
| where message contains "ConcurrencyRetry"
| summarize Reintentos=count() by bin(timestamp, 5m)
| render timechart

// Sesiones con race conditions
traces
| where message contains "ConcurrencyError"
| summarize RaceConditions=dcount(telefono) by bin(timestamp, 1h)
```

**Meta:** <5 reintentos/hora en producción normal.

---

## Backward Compatibility

El código es **100% compatible** con sesiones antiguas:

- Si `Version` no existe en BD → `ISNULL(Version, 0)` devuelve `0`
- Si NO pasas `expectedVersion` → funciona como antes (sin protección)
- Si pasas `expectedVersion=null` → funciona como antes

Esto permite rollout gradual:
1. Deploy código nuevo (con parámetro opcional)
2. Ejecutar migración SQL
3. Activar optimistic locking en código crítico
4. Remover código legacy después de validar

---

## Troubleshooting

### Error: "Column 'Version' is invalid"

**Causa:** Migración SQL no se ejecutó.

**Fix:**
```bash
sqlcmd -S <server> -d <database> -i sql-scripts/migrations/001_add_version_column.sql
```

---

### Muchos reintentos (>20/min)

**Causas posibles:**
1. Meta enviando duplicados agresivamente
2. Múltiples Azure Functions procesando mismo mensaje
3. Operación muy lenta (>500ms) causando overlap

**Fix:**
- Verificar deduplicación de mensajes (`isMessageProcessed`)
- Revisar latencia de operaciones SQL
- Aumentar `maxAttempts` si es transitorio

---

### ConcurrencyError no capturado

**Causa:** Código no usa `withRetry()` o `withSessionRetry()`.

**Fix:** Wrap la operación:
```javascript
await withSessionRetry(telefono, async (session) => {
    // Tu código aquí
});
```

---

## Testing

```javascript
// tests/unit/optimisticLocking.test.js
const db = require('../../core/services/storage/databaseService');
const { ConcurrencyError } = require('../../core/errors');

describe('Optimistic Locking', () => {
    it('should throw ConcurrencyError on version mismatch', async () => {
        const telefono = '+521234567890';
        const session = await db.getSessionWithVersion(telefono);

        // Simular que otra instancia actualizó primero
        await db.updateSession(telefono, ESTADO.REFRI_ESPERA_SAP, null, null, 'BOT', 'Test', null, session.Version);

        // Intentar actualizar con versión antigua debe fallar
        await expect(
            db.updateSession(telefono, ESTADO.VEHICULO_ESPERA_EMPLEADO, null, null, 'BOT', 'Test', null, session.Version)
        ).rejects.toThrow(ConcurrencyError);
    });
});
```

---

## Próximos Pasos

Después de implementar optimistic locking:

1. ✅ Ejecutar migración SQL en desarrollo
2. ✅ Actualizar código crítico en `messageHandler.js`
3. ✅ Actualizar código en flows (`refrigeradorFlow.js`, `vehiculoFlow.js`)
4. ⬜ Testing: simular 2 webhooks concurrentes
5. ⬜ Deploy a producción con feature flag
6. ⬜ Monitorear métricas durante 48h
7. ⬜ Activar optimistic locking para 100% de usuarios

---

**Fecha de implementación:** 2026-02-03
**Fase:** FASE 1.1 - Fixes Críticos
