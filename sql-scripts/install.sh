#!/bin/bash

# =============================================
# Sign Bot - Script de Instalación Automática
# Para Linux/Mac/WSL
# =============================================

set -e  # Exit on error

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║         Sign Bot - INSTALACIÓN AUTOMÁTICA DE BD              ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================
# Verificar que sqlcmd está instalado
# =============================================

if ! command -v sqlcmd &> /dev/null; then
    echo "❌ ERROR: sqlcmd no está instalado"
    echo ""
    echo "Para instalar sqlcmd:"
    echo ""
    echo "  Mac:    brew install sqlcmd"
    echo "  Ubuntu: sudo apt-get install mssql-tools"
    echo "  WSL:    sudo apt-get install mssql-tools"
    echo ""
    exit 1
fi

echo "✅ sqlcmd encontrado: $(which sqlcmd)"
echo ""

# =============================================
# Leer variables de entorno o pedir input
# =============================================

if [ -z "$SQL_SERVER" ]; then
    read -p "🔧 SQL Server (ej: myserver.database.windows.net): " SQL_SERVER
fi

if [ -z "$SQL_DATABASE" ]; then
    read -p "🗄️  Database Name (ej: db-signbot): " SQL_DATABASE
fi

if [ -z "$SQL_USER" ]; then
    read -p "👤 Usuario: " SQL_USER
fi

if [ -z "$SQL_PASSWORD" ]; then
    read -sp "🔑 Password: " SQL_PASSWORD
    echo ""
fi

echo ""
echo "📋 Configuración:"
echo "   Server:   $SQL_SERVER"
echo "   Database: $SQL_DATABASE"
echo "   User:     $SQL_USER"
echo ""

# =============================================
# Verificar conexión
# =============================================

echo "🔌 Verificando conexión a la base de datos..."
echo ""

if ! sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" -Q "SELECT 1" &> /dev/null; then
    echo "❌ ERROR: No se pudo conectar a la base de datos"
    echo ""
    echo "Verifica:"
    echo "  - El servidor está accesible"
    echo "  - Las credenciales son correctas"
    echo "  - El firewall permite tu IP"
    echo ""
    exit 1
fi

echo "✅ Conexión exitosa"
echo ""

# =============================================
# Preguntar qué instalar
# =============================================

echo "¿Qué deseas instalar?"
echo ""
echo "  1) Instalación completa (schema base + FASE 1)"
echo "  2) Solo FASE 1 (actualizar BD existente)"
echo "  3) Solo schema base"
echo ""
read -p "Opción (1-3): " OPCION
echo ""

# =============================================
# Ejecutar scripts según opción
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/install_$TIMESTAMP.log"

echo "📝 Logs se guardarán en: $LOG_FILE"
echo ""

case $OPCION in
    1)
        echo "🚀 Iniciando instalación completa..."
        echo ""

        # Schema base
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "PASO 1/2: Instalando schema base..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""

        if sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
                  -i "$SCRIPT_DIR/install-full-database.sql" \
                  -o "$LOG_FILE.step1.txt" 2>&1; then
            echo "✅ Schema base instalado exitosamente"
            echo ""
        else
            echo "❌ ERROR instalando schema base"
            echo "   Ver logs en: $LOG_FILE.step1.txt"
            exit 1
        fi

        # FASE 1
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "PASO 2/2: Aplicando FASE 1..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""

        if sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
                  -i "$SCRIPT_DIR/install_complete.sql" \
                  -o "$LOG_FILE.step2.txt" 2>&1; then
            echo "✅ FASE 1 aplicada exitosamente"
            echo ""
        else
            echo "❌ ERROR aplicando FASE 1"
            echo "   Ver logs en: $LOG_FILE.step2.txt"
            exit 1
        fi
        ;;

    2)
        echo "🚀 Aplicando solo FASE 1..."
        echo ""

        if sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
                  -i "$SCRIPT_DIR/install_complete.sql" \
                  -o "$LOG_FILE" 2>&1; then
            echo "✅ FASE 1 aplicada exitosamente"
            echo ""
        else
            echo "❌ ERROR aplicando FASE 1"
            echo "   Ver logs en: $LOG_FILE"
            exit 1
        fi
        ;;

    3)
        echo "🚀 Instalando solo schema base..."
        echo ""

        if sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
                  -i "$SCRIPT_DIR/install-full-database.sql" \
                  -o "$LOG_FILE" 2>&1; then
            echo "✅ Schema base instalado exitosamente"
            echo ""
        else
            echo "❌ ERROR instalando schema base"
            echo "   Ver logs en: $LOG_FILE"
            exit 1
        fi
        ;;

    *)
        echo "❌ Opción inválida"
        exit 1
        ;;
esac

# =============================================
# Verificación post-instalación
# =============================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VERIFICACIÓN POST-INSTALACIÓN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verificar tablas principales
echo "🔍 Verificando tablas principales..."
TABLA_COUNT=$(sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
    -Q "SELECT COUNT(*) FROM sys.tables WHERE name IN ('SesionesChat', 'CatEstadoSesion', 'MensajesProcessados', 'Tickets', 'HistorialEstados')" \
    -h -1 -W | tr -d '[:space:]')

if [ "$TABLA_COUNT" = "5" ]; then
    echo "   ✅ Todas las tablas principales existen ($TABLA_COUNT/5)"
else
    echo "   ⚠️  Faltan tablas: solo $TABLA_COUNT/5 encontradas"
fi

# Verificar columna Version (FASE 1)
if [ "$OPCION" = "1" ] || [ "$OPCION" = "2" ]; then
    echo "🔍 Verificando columna Version (FASE 1)..."
    VERSION_EXISTS=$(sqlcmd -S "$SQL_SERVER" -d "$SQL_DATABASE" -U "$SQL_USER" -P "$SQL_PASSWORD" \
        -Q "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('SesionesChat') AND name = 'Version'" \
        -h -1 -W | tr -d '[:space:]')

    if [ "$VERSION_EXISTS" = "1" ]; then
        echo "   ✅ Columna Version existe"
    else
        echo "   ⚠️  Columna Version NO existe"
    fi
fi

echo ""

# =============================================
# Resumen final
# =============================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║              ✅ INSTALACIÓN COMPLETADA                         ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Logs guardados en:"
echo "   $LOG_FILE"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Revisar logs para verificar que no hay errores"
echo "   2. Actualizar código de la aplicación"
echo "   3. Ejecutar tests"
echo "   4. Deploy a desarrollo"
echo ""
echo "📚 Documentación:"
echo "   - FASE 1: docs/FASE_1_IMPLEMENTACION_RESUMEN.md"
echo "   - FASE 2: docs/FASE2-MONITORING-ALERTING.md"
echo ""
