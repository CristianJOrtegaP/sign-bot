#!/bin/bash
# ============================================================================
# AC FIXBOT - Inicializacion de Base de Datos
# ============================================================================
# Este script ejecuta el script SQL para crear todas las tablas,
# stored procedures, vistas y datos de prueba.
# ============================================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Obtener directorios
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_SCRIPT="$PROJECT_ROOT/sql-scripts/install-full-database.sql"
# Nota: CentrosServicio ahora está integrado en install-full-database.sql (v5.4+)

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ----------------------------------------------------------------------------
# VERIFICAR SQLCMD
# ----------------------------------------------------------------------------

check_sqlcmd() {
    if command -v sqlcmd &> /dev/null; then
        log_success "sqlcmd encontrado (nativo)"
        SQLCMD="sqlcmd"
        return 0
    fi

    # Intentar con mssql-cli
    if command -v mssql-cli &> /dev/null; then
        log_success "mssql-cli encontrado"
        SQLCMD="mssql-cli"
        return 0
    fi

    # En macOS, sqlcmd puede estar en un path diferente
    if [ -f "/opt/mssql-tools/bin/sqlcmd" ]; then
        log_success "sqlcmd encontrado en /opt/mssql-tools"
        SQLCMD="/opt/mssql-tools/bin/sqlcmd"
        return 0
    fi

    if [ -f "/opt/mssql-tools18/bin/sqlcmd" ]; then
        log_success "sqlcmd encontrado en /opt/mssql-tools18"
        SQLCMD="/opt/mssql-tools18/bin/sqlcmd"
        return 0
    fi

    log_error "sqlcmd no encontrado"
    echo ""
    echo "Para instalar sqlcmd:"
    echo ""
    echo "  macOS:"
    echo "    brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release"
    echo "    brew update"
    echo "    brew install mssql-tools18"
    echo ""
    echo "  Ubuntu/Debian:"
    echo "    curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -"
    echo "    curl https://packages.microsoft.com/config/ubuntu/20.04/prod.list | sudo tee /etc/apt/sources.list.d/msprod.list"
    echo "    sudo apt-get update"
    echo "    sudo apt-get install mssql-tools unixodbc-dev"
    echo ""
    echo "  Alternativa - usar Azure Data Studio o Azure Portal Query Editor"
    echo ""
    exit 1
}

# ----------------------------------------------------------------------------
# CARGAR CONFIGURACION
# ----------------------------------------------------------------------------

load_config() {
    # Cargar config.env primero (tiene el password y otras configs base)
    if [ -f "${SCRIPT_DIR}/config.env" ]; then
        log_info "Cargando configuracion de config.env..."
        source "${SCRIPT_DIR}/config.env"
    fi

    # Luego cargar deployment-output.env para sobrescribir con valores reales
    if [ -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        log_info "Cargando configuracion de deployment-output.env..."
        source "${SCRIPT_DIR}/deployment-output.env"
    fi

    # Verificar que al menos uno existe
    if [ ! -f "${SCRIPT_DIR}/config.env" ] && [ ! -f "${SCRIPT_DIR}/deployment-output.env" ]; then
        log_error "No se encontro archivo de configuracion"
        log_info "Ejecuta primero deploy-infrastructure.sh o crea config.env"
        exit 1
    fi

    # Verificar variables requeridas
    if [ -z "$SQL_SERVER_NAME" ] || [ -z "$SQL_DATABASE_NAME" ] || [ -z "$SQL_ADMIN_USER" ]; then
        log_error "Faltan variables de configuracion de SQL"
        exit 1
    fi

    # Si no hay password, pedirlo
    if [ -z "$SQL_ADMIN_PASSWORD" ]; then
        echo -n "Ingresa el password de SQL ($SQL_ADMIN_USER): "
        read -s SQL_ADMIN_PASSWORD
        echo ""
    fi

    # Construir FQDN si no existe
    if [ -z "$SQL_SERVER_FQDN" ]; then
        SQL_SERVER_FQDN="${SQL_SERVER_NAME}.database.windows.net"
    fi

    log_success "Configuracion cargada"
    log_info "Server: $SQL_SERVER_FQDN"
    log_info "Database: $SQL_DATABASE_NAME"
    log_info "User: $SQL_ADMIN_USER"
}

# ----------------------------------------------------------------------------
# VERIFICAR SCRIPT SQL
# ----------------------------------------------------------------------------

check_sql_script() {
    if [ ! -f "$SQL_SCRIPT" ]; then
        log_error "Script SQL no encontrado: $SQL_SCRIPT"
        exit 1
    fi
    log_success "Script SQL encontrado: $SQL_SCRIPT"
    log_info "Incluye: tablas, stored procedures, datos de prueba y centros de servicio"
}

# ----------------------------------------------------------------------------
# EJECUTAR SCRIPT SQL
# ----------------------------------------------------------------------------

execute_sql_script() {
    log_info "Ejecutando script SQL..."
    log_warning "Esto eliminara todas las tablas existentes y sus datos"
    echo ""

    # Confirmar (saltar si se paso --yes o -y)
    if [[ "$SKIP_CONFIRM" != "true" ]]; then
        read -p "Continuar? (y/N): " CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            log_info "Operacion cancelada"
            exit 0
        fi
    else
        log_info "Confirmacion automatica (--yes)"
    fi

    echo ""
    log_info "Conectando a $SQL_SERVER_FQDN..."

    # Ejecutar con sqlcmd
    if [[ "$SQLCMD" == "sqlcmd" ]] || [[ "$SQLCMD" == "/opt/mssql-tools"* ]]; then
        $SQLCMD \
            -S "$SQL_SERVER_FQDN" \
            -d "$SQL_DATABASE_NAME" \
            -U "$SQL_ADMIN_USER" \
            -P "$SQL_ADMIN_PASSWORD" \
            -i "$SQL_SCRIPT" \
            -C  # Trust server certificate

        if [ $? -eq 0 ]; then
            log_success "Script SQL ejecutado exitosamente"
        else
            log_error "Error al ejecutar el script SQL"
            exit 1
        fi
    elif [[ "$SQLCMD" == "mssql-cli" ]]; then
        # mssql-cli tiene sintaxis diferente
        $SQLCMD \
            -S "$SQL_SERVER_FQDN" \
            -d "$SQL_DATABASE_NAME" \
            -U "$SQL_ADMIN_USER" \
            -P "$SQL_ADMIN_PASSWORD" \
            -i "$SQL_SCRIPT"
    fi
}

# ----------------------------------------------------------------------------
# VERIFICAR INSTALACION
# ----------------------------------------------------------------------------

verify_installation() {
    log_info "Verificando instalacion..."

    # Query de verificacion
    VERIFY_QUERY="SELECT 'Tablas: ' + CAST(COUNT(*) AS VARCHAR) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"

    RESULT=$($SQLCMD \
        -S "$SQL_SERVER_FQDN" \
        -d "$SQL_DATABASE_NAME" \
        -U "$SQL_ADMIN_USER" \
        -P "$SQL_ADMIN_PASSWORD" \
        -Q "$VERIFY_QUERY" \
        -h -1 \
        -C 2>/dev/null)

    echo "  $RESULT"
    log_success "Verificacion completada"
}

# ----------------------------------------------------------------------------
# ALTERNATIVA: GENERAR SCRIPT PARA AZURE PORTAL
# ----------------------------------------------------------------------------

generate_portal_instructions() {
    echo ""
    echo "============================================================================"
    echo "  ALTERNATIVA: Ejecutar desde Azure Portal"
    echo "============================================================================"
    echo ""
    echo "Si no tienes sqlcmd instalado, puedes ejecutar el script desde Azure Portal:"
    echo ""
    echo "1. Ve a Azure Portal: https://portal.azure.com"
    echo "2. Navega a: SQL databases > $SQL_DATABASE_NAME"
    echo "3. En el menu lateral, selecciona 'Query editor (preview)'"
    echo "4. Inicia sesion con:"
    echo "   - Login: $SQL_ADMIN_USER"
    echo "   - Password: (tu password)"
    echo "5. Copia y pega el contenido de:"
    echo "   $SQL_SCRIPT"
    echo "6. Ejecuta el script"
    echo ""
}

# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================================================"
    echo "  AC FIXBOT - Inicializacion de Base de Datos"
    echo "============================================================================"
    echo ""

    load_config
    check_sql_script

    # Verificar sqlcmd
    if ! check_sqlcmd 2>/dev/null; then
        generate_portal_instructions
        exit 1
    fi

    execute_sql_script
    verify_installation

    echo ""
    echo "============================================================================"
    echo -e "  ${GREEN}BASE DE DATOS INICIALIZADA${NC}"
    echo "============================================================================"
    echo ""
    echo "Tablas creadas:"
    echo "  - CatTipoReporte, CatEstadoSesion, CatEstadoReporte (catalogos)"
    echo "  - Clientes, Equipos (datos maestros)"
    echo "  - Reportes, SesionesChat, HistorialSesiones, MensajesChat"
    echo "  - CentrosServicio (centros de servicio con ubicacion)"
    echo "  - Encuestas, RespuestasEncuesta (satisfaccion)"
    echo ""
    echo "Datos de prueba:"
    echo "  - 8 clientes"
    echo "  - 16 refrigeradores (REF001-REF015, 4045101)"
    echo "  - 10 reportes de ejemplo"
    echo "  - 4 centros de servicio (MTY, CDMX, GDL, QRO)"
    echo ""
    echo "Proximo paso:"
    echo "  ./deploy-function.sh  - Subir codigo de la Function App"
    echo ""
}

# Procesar argumentos
SKIP_CONFIRM="false"
for arg in "$@"; do
    case $arg in
        --portal)
            load_config
            generate_portal_instructions
            exit 0
            ;;
        --yes|-y)
            SKIP_CONFIRM="true"
            ;;
    esac
done

main "$@"
