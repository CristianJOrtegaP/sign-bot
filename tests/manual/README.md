# Smoke Testing - FASE 1

Guía rápida para validar implementación de FASE 1 localmente.

## 1. Verificar Migraciones SQL ✓

```bash
# Ejecutar en Azure SQL Server o local
sqlcmd -S <server> -d <database> -i scripts/verify-migrations.sql
```

Debe mostrar:

- ✅ Columna Version existe
- ✅ Columnas Reintentos, UltimoReintento, Telefono existen

## 2. Iniciar Azure Functions Local

```bash
# Terminal 1
npm start
```

Esperar mensaje: `Host started`

## 3. Test Básico - Deduplicación

```bash
# Terminal 2
./scripts/test-webhook-local.sh
```

**Verificar:**

- Mensaje 1: procesado ✅
- Mensaje 2 (duplicado): devuelve 200 OK ✅
- Logs muestran: `Mensaje duplicado detectado (MERGE)`

## 4. Test Avanzado - Race Condition

```bash
# Terminal 2
./scripts/test-race-condition.sh
```

**Verificar logs:**

- `[ConcurrencyRetry] ... Intento X/3 falló, reintentando`
- Todos los webhooks eventualmente tienen éxito
- Version incrementa correctamente

## 5. Verificar en BD

```sql
-- Ver sesión con versión
SELECT Telefono, Version, Estado
FROM SesionesChat
WHERE Telefono = '+5215512345678'

-- Ver mensajes con reintentos
SELECT WhatsAppMessageId, Reintentos, UltimoReintento
FROM MensajesProcessados
WHERE Telefono = '+5215512345678'
ORDER BY FechaCreacion DESC
```

## ✅ Checklist de Validación

- [ ] Migraciones SQL ejecutadas correctamente
- [ ] Azure Functions inicia sin errores
- [ ] Deduplicación funciona (mensaje duplicado rechazado)
- [ ] Optimistic locking funciona (Version incrementa)
- [ ] Race condition manejado con retry exitoso
- [ ] Timeouts no causan problemas (<5s respuesta)
- [ ] Circuit breaker mantiene estado CLOSED
- [ ] Sin errores en logs de Application Insights

## 🐛 Troubleshooting

**Error: "Column 'Version' is invalid"**
→ Ejecutar migración 001_add_version_column.sql

**Error: "Cannot find module 'mssql'"**
→ `npm install`

**Webhook devuelve 500**
→ Verificar connection string en local.settings.json

**ConcurrencyError sin retry**
→ Verificar que código usa withSessionRetry()
