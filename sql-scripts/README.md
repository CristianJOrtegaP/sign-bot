# AC FixBot - Scripts SQL

Este directorio contiene todos los scripts SQL necesarios para instalar y mantener la base de datos AC FixBot.

## 📋 Orden de Ejecución para Instalación Completa

### Opción 1: Instalación Automática (Recomendado)

```bash
# Windows (PowerShell)
.\sql-scripts\install.ps1

# Linux/Mac
./sql-scripts/install.sh
```

### Opción 2: Instalación Manual

```bash
# 1. Instalar schema base
sqlcmd -S <server> -d <database> -U <user> -P <password> -i sql-scripts/install-full-database.sql

# 2. Aplicar migraciones FASE 1 + Estados adicionales
sqlcmd -S <server> -d <database> -U <user> -P <password> -i sql-scripts/install_complete.sql
```

### Opción 3: Azure SQL Database (Portal)

1. Ir a Azure Portal → SQL Database → Query Editor
2. Copiar y ejecutar el contenido de `install-full-database.sql`
3. Copiar y ejecutar el contenido de `install_complete.sql`

---

## 📁 Descripción de Archivos

### Scripts SQL

| Archivo                       | Tamaño | Descripción                                                   | Cuando Usar             |
| ----------------------------- | ------ | ------------------------------------------------------------- | ----------------------- |
| **install-full-database.sql** | 67KB   | Schema base completo (tablas, SPs, triggers, datos iniciales) | Primera instalación     |
| **install_complete.sql**      | 18KB   | ✨ Consolidado FASE 1 + Estados adicionales                   | Después del schema base |
| **cleanup-database.sql**      | 3.4KB  | Limpia toda la BD (⚠️ PELIGROSO)                              | Solo para desarrollo    |

### Scripts de Automatización

| Archivo         | Plataforma         | Descripción                                  |
| --------------- | ------------------ | -------------------------------------------- |
| **install.sh**  | Linux/Mac/WSL      | Script interactivo de instalación automática |
| **install.ps1** | Windows PowerShell | Script interactivo de instalación automática |

### Contenido de install_complete.sql

Este archivo consolidado incluye:

- ✅ **FASE 1 - Optimistic Locking**
  - Columna `Version` en `SesionesChat`
  - Índice `IX_SesionesChat_Telefono_Version`

- ✅ **FASE 1 - Deduplicación Idempotente**
  - Columnas `Reintentos`, `UltimoReintento`, `Telefono` en `MensajesProcessados`
  - Índice `IX_MensajesProcessados_Telefono`

- ✅ **Estados Adicionales**
  - `CONSULTA_ESPERA_TICKET`
  - `VEHICULO_CONFIRMAR_DATOS_AI`

- ✅ **Verificaciones Automáticas**
  - Verifica schema base
  - Verifica todas las migraciones aplicadas
  - Muestra estadísticas post-instalación

---

## 🚀 Instalación Rápida

### Para Nueva Instalación (Base de datos vacía):

```bash
# 1. Configurar variables de entorno
export SQL_SERVER="your-server.database.windows.net"
export SQL_DATABASE="db-acfixbot"
export SQL_USER="your-user"
export SQL_PASSWORD="your-password"

# 2. Ejecutar instalación completa
sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -i sql-scripts/install-full-database.sql
sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -i sql-scripts/install_complete.sql
```

### Para Actualizar Base de Datos Existente (Solo FASE 1):

```bash
# Solo aplicar migraciones FASE 1
sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -i sql-scripts/install_complete.sql
```

---

## 🔍 Verificación Post-Instalación

Después de ejecutar los scripts, verificar que todo está correcto:

```sql
-- Verificar tablas principales
SELECT name FROM sys.tables
WHERE name IN (
    'SesionesChat',
    'CatEstadoSesion',
    'MensajesProcessados',
    'Tickets',
    'HistorialEstados',
    'DeadLetterMessages'
)
ORDER BY name

-- Verificar columna Version (FASE 1)
SELECT
    c.name AS ColumnName,
    t.name AS DataType,
    c.is_nullable AS IsNullable,
    ISNULL(d.definition, '') AS DefaultValue
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
LEFT JOIN sys.default_constraints d ON c.default_object_id = d.object_id
WHERE c.object_id = OBJECT_ID('SesionesChat')
AND c.name = 'Version'

-- Verificar índices FASE 1
SELECT
    i.name AS IndexName,
    OBJECT_NAME(i.object_id) AS TableName,
    i.type_desc AS IndexType
FROM sys.indexes i
WHERE i.name IN (
    'IX_SesionesChat_Telefono_Version',
    'IX_MensajesProcessados_Telefono'
)

-- Verificar estados adicionales
SELECT EstadoId, Codigo, Nombre, Descripcion
FROM CatEstadoSesion
WHERE Codigo IN (
    'CONSULTA_ESPERA_TICKET',
    'VEHICULO_CONFIRMAR_DATOS_AI'
)

-- Verificar stored procedures
SELECT name FROM sys.procedures
WHERE name LIKE 'sp_%'
ORDER BY name
```

---

## 🔄 Rollback y Limpieza

### Rollback de Migraciones FASE 1

Si necesitas revertir los cambios de FASE 1:

```sql
-- Remover columna Version
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SesionesChat') AND name = 'Version')
BEGIN
    DROP INDEX IF EXISTS IX_SesionesChat_Telefono_Version ON SesionesChat
    ALTER TABLE SesionesChat DROP COLUMN Version
END

-- Remover columnas de deduplicación
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'Reintentos')
BEGIN
    DROP INDEX IF EXISTS IX_MensajesProcessados_Telefono ON MensajesProcessados
    ALTER TABLE MensajesProcessados DROP COLUMN Reintentos
    ALTER TABLE MensajesProcessados DROP COLUMN UltimoReintento
    ALTER TABLE MensajesProcessados DROP COLUMN Telefono
END
```

### Limpiar Base de Datos Completa (⚠️ PELIGROSO)

```bash
# Solo en desarrollo!
sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -i sql-scripts/cleanup-database.sql
```

---

## 📊 Logs y Debugging

Durante la ejecución de los scripts, verás mensajes como:

```
✅ - Operación exitosa
⚠️  - Warning (item ya existe, omitiendo)
❌ - Error crítico
📊 - Estadísticas
📝 - Información
```

### Logs Esperados (Instalación Exitosa)

```
╔════════════════════════════════════════════════════════════════╗
║            AC FIXBOT - INSTALACIÓN COMPLETA                    ║
║                    Version 2.0                                 ║
╚════════════════════════════════════════════════════════════════╝

┌────────────────────────────────────────────────────────────────┐
│ SECCIÓN 1: Verificando Schema Base                            │
└────────────────────────────────────────────────────────────────┘
✅ Schema base verificado: Todas las tablas principales existen

┌────────────────────────────────────────────────────────────────┐
│ SECCIÓN 2: FASE 1 - Optimistic Locking                        │
└────────────────────────────────────────────────────────────────┘
   [2.1] Agregando columna Version a SesionesChat...
   ✅ Columna Version agregada
   ✅ Verificación: Columna Version existe
   📊 Total de sesiones: 0
   [2.2] Creando índice IX_SesionesChat_Telefono_Version...
   ✅ Índice creado exitosamente

✅ FASE 1 - Optimistic Locking completado

... (más logs) ...

╔════════════════════════════════════════════════════════════════╗
║              ✅ INSTALACIÓN COMPLETADA                         ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 🔧 Troubleshooting

### Error: "Schema base incompleto"

**Causa:** No se ejecutó `install-full-database.sql` primero

**Solución:**

```bash
sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -i sql-scripts/install-full-database.sql
```

### Error: "Columna Version ya existe"

**Causa:** La migración FASE 1 ya fue aplicada

**Solución:** Esto es solo un warning, continúa la ejecución normalmente.

### Error: "Cannot insert duplicate key in object 'CatEstadoSesion'"

**Causa:** Estados adicionales ya existen

**Solución:** Los scripts usan `IF NOT EXISTS`, revisa los logs para ver qué secciones se omitieron.

### Error de permisos

**Causa:** Usuario no tiene permisos suficientes

**Solución:**

```sql
-- Otorgar permisos de db_owner (solo para desarrollo)
ALTER ROLE db_owner ADD MEMBER [your-user]
```

---

## 📚 Documentación Relacionada

- **FASE 1 Implementación:** [../docs/FASE_1_IMPLEMENTACION_RESUMEN.md](../docs/FASE_1_IMPLEMENTACION_RESUMEN.md)
- **FASE 2 Monitoring:** [../docs/FASE2-MONITORING-ALERTING.md](../docs/FASE2-MONITORING-ALERTING.md)
- **Optimistic Locking:** [../docs/OPTIMISTIC_LOCKING_USAGE.md](../docs/OPTIMISTIC_LOCKING_USAGE.md)
- **Observability Guide:** [../docs/observability-guide.md](../docs/observability-guide.md)

---

## 📞 Soporte

Si encuentras problemas durante la instalación:

1. Revisa los logs de ejecución
2. Verifica la sección de Troubleshooting arriba
3. Consulta la documentación relacionada
4. Revisa el código SQL de los scripts individuales en `migrations/`

---

## 📝 Notas Importantes

⚠️ **IMPORTANTE:**

- Siempre hacer backup antes de ejecutar en producción
- Ejecutar en desarrollo/staging primero
- Los scripts son idempotentes (seguros para ejecutar múltiples veces)
- Si un item ya existe, se omite con warning (⚠️)

✅ **Buenas Prácticas:**

- Ejecutar en horarios de bajo tráfico
- Monitorear Application Insights después del deploy
- Verificar logs durante la ejecución
- Documentar cualquier modificación manual

🔒 **Seguridad:**

- Usar Azure Key Vault para credenciales
- No hardcodear passwords en scripts
- Usar variables de entorno o archivos de configuración
- Restringir permisos de usuarios a lo necesario
