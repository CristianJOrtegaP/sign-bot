# AC FixBot - Arquitectura de Seguridad

Este documento describe los controles de seguridad implementados en AC FixBot para proteger datos sensibles, prevenir ataques y cumplir con requisitos de compliance.

---

## 1. Principios de Seguridad

### Defense in Depth

El sistema implementa múltiples capas de protección:

1. **Capa de Red**: Azure Functions con HTTPS obligatorio
2. **Capa de Aplicación**: Validación de firmas, rate limiting, sanitización
3. **Capa de Datos**: Conexiones cifradas, TDE en SQL, Key Vault para secretos

### Least Privilege

- Azure Functions usa Managed Identity
- Acceso a Key Vault solo con permisos `get` y `list`
- Usuario SQL con permisos mínimos necesarios

### Fail Secure

- Circuit breakers protegen contra cascadas de fallas
- Dead Letter Queue captura mensajes que no se pueden procesar
- Fallbacks seguros cuando servicios externos fallan

---

## 2. Autenticación y Autorización

### 2.1 Webhook de WhatsApp

**Mecanismo**: Verificación de firma HMAC-SHA256

```
Header: X-Hub-Signature-256
Formato: sha256=<signature>
```

**Implementación** (`securityService.js`):

- Firma calculada con `WHATSAPP_APP_SECRET`
- Comparación timing-safe para prevenir timing attacks
- Rechazo inmediato si firma no coincide (401)

**Protecciones**:

- ✅ HMAC-SHA256 (no vulnerable a length extension)
- ✅ Timing-safe comparison
- ✅ Secreto almacenado en Key Vault

### 2.2 Endpoints Administrativos

**Mecanismo**: Azure Function Keys (authLevel: "function")

```
Header: x-functions-key: <host-key>
```

Obtener en: Azure Portal → Function App → App Keys → Host keys

**Protecciones**:

- ✅ Validación nativa por Azure (antes de ejecutar código)
- ✅ Keys rotables desde Azure Portal
- ✅ Rate limiting por IP (60 req/min)
- ✅ Logging de todos los accesos

### 2.3 Azure AD (Easy Auth) - Opcional

Si `ENABLE_EASY_AUTH=true`:

- Autenticación con Azure AD
- Solo usuarios del tenant permitidos
- MFA si está configurado en el tenant

---

## 3. Protección de Datos

### 3.1 Datos en Tránsito

| Conexión                   | Protocolo | Versión TLS |
| -------------------------- | --------- | ----------- |
| WhatsApp → Azure Functions | HTTPS     | TLS 1.2+    |
| Functions → SQL Database   | TDS       | TLS 1.2     |
| Functions → Redis          | REDISS    | TLS 1.2     |
| Functions → Blob Storage   | HTTPS     | TLS 1.2     |
| Functions → AI Services    | HTTPS     | TLS 1.2     |

### 3.2 Datos en Reposo

| Almacén      | Cifrado            | Tipo          |
| ------------ | ------------------ | ------------- |
| Azure SQL    | TDE                | AES-256       |
| Blob Storage | SSE                | AES-256       |
| Redis Cache  | At-rest encryption | AES-256       |
| Key Vault    | HSM-backed         | FIPS 140-2 L2 |

### 3.3 Sanitización de Logs

**Datos Redactados Automáticamente**:

- Tokens y API keys → `[REDACTED:token]`
- Passwords → `[REDACTED:password]`
- Connection strings → `[REDACTED:connectionString]`
- Teléfonos → `521551****1234` (parcialmente ocultos)

**Implementación** (`sanitizer.js`):

```javascript
SENSITIVE_PATTERNS = [
  'token',
  'apiKey',
  'accessToken',
  'bearer',
  'secret',
  'password',
  'pwd',
  'connectionString',
  'sasToken',
  'subscriptionKey',
];
```

---

## 4. Validación de Inputs

### 4.1 Payloads de Webhook

**Validaciones**:

- Estructura de mensaje WhatsApp válida
- Tipo de mensaje conocido (text, image, audio, interactive, location)
- Tamaño de contenido limitado
- Caracteres especiales sanitizados

### 4.2 Códigos SAP

**Formato**: Exactamente 7 dígitos numéricos

```javascript
const sapCodeSchema = z
  .string()
  .length(7, 'Código SAP debe tener 7 dígitos')
  .regex(/^\d{7}$/, 'Código SAP debe ser numérico');
```

**Validación adicional**: Verificación contra base de datos antes de usar.

### 4.3 Números de Teléfono

**Formato**: 10-15 dígitos numéricos

```javascript
const phoneSchema = z.string().min(10).max(15).regex(/^\d+$/);
```

### 4.4 Ubicaciones

**Validaciones**:

- Latitud: -90 a 90
- Longitud: -180 a 180
- Precisión limitada a 6 decimales

---

## 5. Rate Limiting

### 5.1 Por Usuario (Teléfono)

| Recurso           | Límite/Minuto | Límite/Hora |
| ----------------- | ------------- | ----------- |
| Mensajes de texto | 20            | 100         |
| Imágenes          | 3             | 20          |
| Audios            | 3             | 30          |

### 5.2 Detección de Spam

**Criterio**: >10 mensajes en 10 segundos

**Acción**: Mensaje de advertencia al usuario, no bloqueo total.

### 5.3 Por IP (Endpoints Admin)

| Endpoint      | Límite/Minuto |
| ------------- | ------------- |
| /api/admin-\* | 100           |
| /api/metrics  | 100           |
| /api/health   | 500           |

### 5.4 Rate Limiting Distribuido (FASE 3)

**Mecanismo**: Redis con sliding window

**Ventajas**:

- Funciona en múltiples instancias de Azure Functions
- Fallback automático a memoria si Redis no está disponible
- TTL automático para limpieza

---

## 6. Gestión de Secretos

### 6.1 Variables Sensibles

| Secreto               | Almacenamiento | Rotación   |
| --------------------- | -------------- | ---------- |
| WHATSAPP_APP_SECRET   | Key Vault      | Manual     |
| SQL_CONNECTION_STRING | Key Vault      | Manual     |
| GEMINI_API_KEY        | Key Vault      | Manual     |
| AZURE_OPENAI_KEY      | Key Vault      | Manual     |
| Function Keys (Admin) | Azure Portal   | Via Portal |
| REDIS_PASSWORD        | Key Vault      | Manual     |

### 6.2 Key Vault Integration

**Método**: Key Vault References en App Settings

```
SQL_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=https://acfixbot-kv.vault.azure.net/secrets/SQL-CONNECTION-STRING/)
```

**Ventajas**:

- Secretos nunca en código o archivos de configuración
- Auditoría de acceso automática
- Rotación sin redespliegue

### 6.3 Managed Identity

La Function App usa System Assigned Managed Identity para:

- Acceso a Key Vault (sin credenciales en código)
- Acceso a Blob Storage
- Acceso a Service Bus

---

## 7. Auditoría

### 7.1 Eventos Auditados

| Evento              | Severidad | Persistencia |
| ------------------- | --------- | ------------ |
| AUTH_FAILURE        | WARNING   | SQL + Logs   |
| SIGNATURE_INVALID   | WARNING   | SQL + Logs   |
| RATE_LIMIT_EXCEEDED | WARNING   | SQL + Logs   |
| ADMIN_CACHE_CLEAR   | INFO      | SQL + Logs   |
| TICKET_CREATED      | INFO      | SQL + Logs   |
| TICKET_RESOLVED     | INFO      | SQL + Logs   |
| SESSION_TIMEOUT     | INFO      | Logs         |

### 7.2 Retención

| Tipo                 | Retención |
| -------------------- | --------- |
| AuditEvents (SQL)    | 90 días   |
| Application Insights | 30 días   |
| Blob Storage logs    | 30 días   |

### 7.3 Información Capturada

Para cada evento de auditoría:

- Timestamp (UTC)
- Correlation ID
- Tipo de evento y severidad
- IP del cliente (si disponible)
- User-Agent
- Detalles específicos del evento

---

## 8. Protección contra Ataques Comunes

### 8.1 Injection Attacks

**SQL Injection**:

- ✅ Queries parametrizadas con `mssql`
- ✅ No concatenación de strings en queries
- ✅ Input validation con Zod

**XSS**:

- ✅ Respuestas son texto plano, no HTML
- ✅ Content-Type headers correctos
- ✅ Sanitización de inputs

### 8.2 Denial of Service (DoS)

**Protecciones**:

- ✅ Rate limiting por usuario y por IP
- ✅ Circuit breakers para servicios externos
- ✅ Límite de memoria en Maps (10,000 IPs máximo)
- ✅ Azure Functions auto-scaling

### 8.3 Timing Attacks

**Protecciones**:

- ✅ `crypto.timingSafeEqual()` para comparación de secretos
- ✅ Respuesta uniforme independiente del resultado

### 8.4 Information Disclosure

**Protecciones**:

- ✅ Stack traces no expuestos a usuarios
- ✅ Mensajes de error genéricos para usuarios
- ✅ Logs sanitizados antes de persistir

---

## 9. Compliance

### 9.1 Datos Personales

**Datos almacenados**:

- Número de teléfono (identificador principal)
- Nombre de perfil de WhatsApp (opcional)
- Historial de conversaciones (para contexto)

**Protecciones GDPR/LFPDPPP**:

- Datos cifrados en reposo y tránsito
- Retención limitada (sesiones expiran en 5 minutos de inactividad)
- Logs sanitizados (teléfonos parcialmente ocultos)

### 9.2 Auditoría de Acceso

Todos los accesos a datos sensibles se registran en:

- Application Insights
- Tabla AuditEvents en SQL

---

## 10. Respuesta a Incidentes de Seguridad

### 10.1 Detección

**Mecanismos**:

- Alertas de Application Insights (anomaly detection)
- Alertas de rate limit excedido
- Monitoreo de firmas inválidas

### 10.2 Contención

**Acciones automáticas**:

- Circuit breakers se activan ante fallas repetidas
- Rate limiting bloquea usuarios/IPs maliciosos
- Dead Letter Queue captura mensajes sospechosos

**Acciones manuales**:

```bash
# Bloquear IP específica (via Azure Firewall)
az network firewall rule create ...

# Desactivar webhook temporalmente
az functionapp config appsettings set --name acfixbot-func \
    --settings WHATSAPP_WEBHOOK_DISABLED=true
```

### 10.3 Erradicación

1. Identificar vector de ataque
2. Parchear vulnerabilidad
3. Rotar secretos si fueron comprometidos
4. Revisar logs de auditoría

### 10.4 Recuperación

1. Verificar integridad de datos
2. Reprocesar Dead Letter Queue si es necesario
3. Restaurar servicios gradualmente
4. Monitoreo intensivo post-incidente

---

## 11. Recomendaciones Futuras

### Alta Prioridad

- [ ] Implementar WAF (Web Application Firewall)
- [ ] Agregar MFA para endpoints admin
- [ ] Penetration testing externo

### Media Prioridad

- [ ] SIEM integration (Azure Sentinel)
- [ ] Rotación automática de secretos
- [ ] DLP (Data Loss Prevention) policies

### Baja Prioridad

- [ ] OAuth2 para admin endpoints (reemplazar API Key)
- [ ] Geoblocking si el servicio es regional
- [ ] Bug bounty program
