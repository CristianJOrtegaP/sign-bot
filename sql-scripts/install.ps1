# =============================================
# AC FixBot - Script de Instalación Automática
# Para Windows PowerShell
# =============================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗"
Write-Host "║                                                                ║"
Write-Host "║         AC FIXBOT - INSTALACIÓN AUTOMÁTICA DE BD              ║"
Write-Host "║                                                                ║"
Write-Host "╚════════════════════════════════════════════════════════════════╝"
Write-Host ""

# =============================================
# Verificar que sqlcmd está instalado
# =============================================

try {
    $null = Get-Command sqlcmd -ErrorAction Stop
    Write-Host "✅ sqlcmd encontrado: $(Get-Command sqlcmd | Select-Object -ExpandProperty Source)"
    Write-Host ""
} catch {
    Write-Host "❌ ERROR: sqlcmd no está instalado" -ForegroundColor Red
    Write-Host ""
    Write-Host "Para instalar sqlcmd:"
    Write-Host "  Descarga desde: https://docs.microsoft.com/en-us/sql/tools/sqlcmd-utility"
    Write-Host ""
    exit 1
}

# =============================================
# Leer variables de entorno o pedir input
# =============================================

if (-not $env:SQL_SERVER) {
    $SQL_SERVER = Read-Host "🔧 SQL Server (ej: myserver.database.windows.net)"
} else {
    $SQL_SERVER = $env:SQL_SERVER
}

if (-not $env:SQL_DATABASE) {
    $SQL_DATABASE = Read-Host "🗄️  Database Name (ej: db-acfixbot)"
} else {
    $SQL_DATABASE = $env:SQL_DATABASE
}

if (-not $env:SQL_USER) {
    $SQL_USER = Read-Host "👤 Usuario"
} else {
    $SQL_USER = $env:SQL_USER
}

if (-not $env:SQL_PASSWORD) {
    $SecurePassword = Read-Host "🔑 Password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    $SQL_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
} else {
    $SQL_PASSWORD = $env:SQL_PASSWORD
}

Write-Host ""
Write-Host "📋 Configuración:"
Write-Host "   Server:   $SQL_SERVER"
Write-Host "   Database: $SQL_DATABASE"
Write-Host "   User:     $SQL_USER"
Write-Host ""

# =============================================
# Verificar conexión
# =============================================

Write-Host "🔌 Verificando conexión a la base de datos..."
Write-Host ""

try {
    $result = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD -Q "SELECT 1" -h -1 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Connection failed"
    }
    Write-Host "✅ Conexión exitosa"
    Write-Host ""
} catch {
    Write-Host "❌ ERROR: No se pudo conectar a la base de datos" -ForegroundColor Red
    Write-Host ""
    Write-Host "Verifica:"
    Write-Host "  - El servidor está accesible"
    Write-Host "  - Las credenciales son correctas"
    Write-Host "  - El firewall permite tu IP"
    Write-Host ""
    exit 1
}

# =============================================
# Preguntar qué instalar
# =============================================

Write-Host "¿Qué deseas instalar?"
Write-Host ""
Write-Host "  1) Instalación completa (schema base + FASE 1)"
Write-Host "  2) Solo FASE 1 (actualizar BD existente)"
Write-Host "  3) Solo schema base"
Write-Host ""
$OPCION = Read-Host "Opción (1-3)"
Write-Host ""

# =============================================
# Ejecutar scripts según opción
# =============================================

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$LOG_DIR = Join-Path $SCRIPT_DIR "logs"

if (-not (Test-Path $LOG_DIR)) {
    New-Item -ItemType Directory -Path $LOG_DIR | Out-Null
}

$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
$LOG_FILE = Join-Path $LOG_DIR "install_$TIMESTAMP.log"

Write-Host "📝 Logs se guardarán en: $LOG_FILE"
Write-Host ""

switch ($OPCION) {
    "1" {
        Write-Host "🚀 Iniciando instalación completa..."
        Write-Host ""

        # Schema base
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        Write-Host "PASO 1/2: Instalando schema base..."
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        Write-Host ""

        $result = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
                  -i "$SCRIPT_DIR\install-full-database.sql" `
                  -o "$LOG_FILE.step1.txt" 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Schema base instalado exitosamente" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "❌ ERROR instalando schema base" -ForegroundColor Red
            Write-Host "   Ver logs en: $LOG_FILE.step1.txt"
            exit 1
        }

        # FASE 1
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        Write-Host "PASO 2/2: Aplicando FASE 1..."
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        Write-Host ""

        $result = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
                  -i "$SCRIPT_DIR\install_complete.sql" `
                  -o "$LOG_FILE.step2.txt" 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ FASE 1 aplicada exitosamente" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "❌ ERROR aplicando FASE 1" -ForegroundColor Red
            Write-Host "   Ver logs en: $LOG_FILE.step2.txt"
            exit 1
        }
    }

    "2" {
        Write-Host "🚀 Aplicando solo FASE 1..."
        Write-Host ""

        $result = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
                  -i "$SCRIPT_DIR\install_complete.sql" `
                  -o "$LOG_FILE" 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ FASE 1 aplicada exitosamente" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "❌ ERROR aplicando FASE 1" -ForegroundColor Red
            Write-Host "   Ver logs en: $LOG_FILE"
            exit 1
        }
    }

    "3" {
        Write-Host "🚀 Instalando solo schema base..."
        Write-Host ""

        $result = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
                  -i "$SCRIPT_DIR\install-full-database.sql" `
                  -o "$LOG_FILE" 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Schema base instalado exitosamente" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "❌ ERROR instalando schema base" -ForegroundColor Red
            Write-Host "   Ver logs en: $LOG_FILE"
            exit 1
        }
    }

    default {
        Write-Host "❌ Opción inválida" -ForegroundColor Red
        exit 1
    }
}

# =============================================
# Verificación post-instalación
# =============================================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "VERIFICACIÓN POST-INSTALACIÓN"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""

# Verificar tablas principales
Write-Host "🔍 Verificando tablas principales..."
$TABLA_COUNT = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
    -Q "SELECT COUNT(*) FROM sys.tables WHERE name IN ('SesionesChat', 'CatEstadoSesion', 'MensajesProcessados', 'Tickets', 'HistorialEstados')" `
    -h -1 -W | Select-String -Pattern '\d+' | ForEach-Object { $_.Matches.Value.Trim() }

if ($TABLA_COUNT -eq "5") {
    Write-Host "   ✅ Todas las tablas principales existen ($TABLA_COUNT/5)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Faltan tablas: solo $TABLA_COUNT/5 encontradas" -ForegroundColor Yellow
}

# Verificar columna Version (FASE 1)
if ($OPCION -eq "1" -or $OPCION -eq "2") {
    Write-Host "🔍 Verificando columna Version (FASE 1)..."
    $VERSION_EXISTS = & sqlcmd -S $SQL_SERVER -d $SQL_DATABASE -U $SQL_USER -P $SQL_PASSWORD `
        -Q "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('SesionesChat') AND name = 'Version'" `
        -h -1 -W | Select-String -Pattern '\d+' | ForEach-Object { $_.Matches.Value.Trim() }

    if ($VERSION_EXISTS -eq "1") {
        Write-Host "   ✅ Columna Version existe" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Columna Version NO existe" -ForegroundColor Yellow
    }
}

Write-Host ""

# =============================================
# Resumen final
# =============================================

Write-Host "╔════════════════════════════════════════════════════════════════╗"
Write-Host "║                                                                ║"
Write-Host "║              ✅ INSTALACIÓN COMPLETADA                         ║"
Write-Host "║                                                                ║"
Write-Host "╚════════════════════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "📋 Logs guardados en:"
Write-Host "   $LOG_FILE"
Write-Host ""
Write-Host "📝 Próximos pasos:"
Write-Host "   1. Revisar logs para verificar que no hay errores"
Write-Host "   2. Actualizar código de la aplicación"
Write-Host "   3. Ejecutar tests"
Write-Host "   4. Deploy a desarrollo"
Write-Host ""
Write-Host "📚 Documentación:"
Write-Host "   - FASE 1: docs\FASE_1_IMPLEMENTACION_RESUMEN.md"
Write-Host "   - FASE 2: docs\FASE2-MONITORING-ALERTING.md"
Write-Host ""
