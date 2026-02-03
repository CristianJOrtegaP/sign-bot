# Guia de Testing - AC FixBot

Esta guia cubre la estrategia de testing, ejecucion de pruebas y mejores practicas.

---

## Indice

1. [Estrategia de Testing](#1-estrategia-de-testing)
2. [Estructura de Tests](#2-estructura-de-tests)
3. [Ejecucion de Tests](#3-ejecucion-de-tests)
4. [Tests Unitarios](#4-tests-unitarios)
5. [Tests de Integracion](#5-tests-de-integracion)
6. [Tests E2E](#6-tests-e2e)
7. [Tests de Contratos](#7-tests-de-contratos)
8. [Tests de Seguridad](#8-tests-de-seguridad)
9. [Tests de Carga](#9-tests-de-carga)
10. [Mocks y Fixtures](#10-mocks-y-fixtures)
11. [Cobertura de Codigo](#11-cobertura-de-codigo)
12. [CI/CD Integration](#12-cicd-integration)

---

## 1. Estrategia de Testing

### Piramide de Tests

```
         /\
        /  \      E2E Tests (10%)
       /----\     - Flujos completos de usuario
      /      \    - Integracion con mocks
     /--------\
    /          \  Integration Tests (20%)
   /------------\ - Escenarios de conversacion
  /              \- APIs completas
 /----------------\
/                  \ Unit Tests (70%)
                     - Handlers, Services, Utilities
                     - Validaciones
```

### Tipos de Tests

| Tipo | Proposito | Herramientas |
|------|-----------|--------------|
| Unit | Funciones aisladas | Jest |
| Integration | Componentes conectados | Jest + Mocks |
| E2E | Flujos completos | Jest + Mocks |
| Contract | Validar APIs | Jest + Zod |
| Security | Vulnerabilidades | Jest |
| Load | Rendimiento | Artillery |

---

## 2. Estructura de Tests

```
tests/
├── unit/                    # Tests unitarios
│   ├── helpers.test.js
│   ├── messageHandler.test.js
│   ├── intentService.test.js
│   ├── whatsappService.test.js
│   ├── circuitBreaker.test.js
│   └── ...
├── integration/             # Tests de integracion
│   ├── webhookApi.test.js
│   ├── conversationScenarios.test.js
│   └── ticketResolveApi.test.js
├── e2e/                     # Tests end-to-end
│   └── completeFlows.test.js
├── flows/                   # Tests de flujos especificos
│   ├── refrigeradorFlow.test.js
│   ├── vehiculoFlow.test.js
│   └── encuestaFlow.test.js
├── contracts/               # Tests de contratos de API
│   └── apiContracts.test.js
├── security/                # Tests de seguridad
│   └── securityTests.test.js
├── load/                    # Configuracion de tests de carga
│   ├── artillery.yml
│   ├── artillery-quick.yml
│   └── artillery-stress.yml
├── fixtures/                # Datos de prueba
│   ├── whatsappPayloads.js
│   └── databaseRecords.js
├── __mocks__/               # Mocks de servicios
│   ├── whatsappService.js
│   ├── databaseService.js
│   ├── aiService.js
│   ├── visionService.js
│   └── config.js
├── setup.js                 # Setup global de Jest
└── setupMocks.js            # Setup de mocks
```

---

## 3. Ejecucion de Tests

### Comandos Principales

```bash
# Ejecutar todos los tests
npm test

# Tests con cobertura
npm run test:coverage

# Tests en modo watch
npm run test:watch

# Tests verbosos
npm run test:verbose
```

### Por Categoria

```bash
# Solo tests unitarios
npm run test:unit

# Solo tests de integracion
npm run test:integration

# Solo tests de flujos
npm run test:flows

# Tests de webhook
npm run test:webhook

# Tests de handlers
npm run test:handlers

# Tests de servicios
npm run test:services
```

### Tests Especificos

```bash
# Ejecutar un archivo especifico
npx jest tests/unit/messageHandler.test.js

# Ejecutar tests que coincidan con patron
npx jest --testNamePattern="refrigerador"

# Ejecutar con debug
npm run test:debug
```

---

## 4. Tests Unitarios

### Ejemplo: Test de Handler

```javascript
// tests/unit/messageHandler.test.js

describe('MessageHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('handleText', () => {
        test('debe procesar mensaje de texto', async () => {
            const telefono = '+5215512345678';
            const texto = 'Hola';
            const messageId = 'msg_123';

            await messageHandler.handleText(telefono, texto, messageId, mockContext);

            expect(whatsapp.sendButtons).toHaveBeenCalled();
        });

        test('debe manejar errores gracefully', async () => {
            intentService.detectIntent.mockRejectedValueOnce(new Error('AI Error'));

            await expect(
                messageHandler.handleText('+521...', 'test', 'msg', mockContext)
            ).resolves.not.toThrow();
        });
    });
});
```

### Patrones Recomendados

1. **Arrange-Act-Assert (AAA)**
```javascript
test('descripcion clara', () => {
    // Arrange
    const input = 'datos de entrada';

    // Act
    const result = funcionAProbar(input);

    // Assert
    expect(result).toBe('resultado esperado');
});
```

2. **Test aislados**
```javascript
beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();
    whatsapp.__reset();
});
```

---

## 5. Tests de Integracion

### Escenarios de Conversacion

```javascript
// tests/integration/conversationScenarios.test.js

describe('Flujo Refrigerador', () => {
    test('conversacion completa', async () => {
        // Paso 1: Saludo
        await sendMessage('Hola');
        expect(getLastMessage().buttons).toBeDefined();

        // Paso 2: Seleccionar tipo
        await pressButton('btn_tipo_refrigerador');
        expect(getLastMessage().text).toContain('SAP');

        // Paso 3: Ingresar SAP
        await sendMessage('1234567');
        expect(getLastMessage().buttons).toContain('btn_confirmar_equipo');

        // ...continuar flujo
    });
});
```

---

## 6. Tests E2E

### Flujos Completos

```javascript
// tests/e2e/completeFlows.test.js

describe('E2E - Flujos Completos', () => {
    test('Flujo Refrigerador - Camino Feliz', async () => {
        // Simula toda la conversacion desde saludo hasta ticket
        mockIntent('SALUDO');
        let messages = await sendText('Hola');
        expect(messages.some(m => m.buttons)).toBe(true);

        messages = await pressButton('btn_tipo_refrigerador');
        expect(messages.some(m => m.text?.includes('SAP'))).toBe(true);

        // ...hasta crear ticket
        expect(db.createReporte).toHaveBeenCalled();
    });

    test('Flujo con Errores y Recuperacion', async () => {
        // SAP invalido -> correccion -> exito
    });
});
```

---

## 7. Tests de Contratos

### Validacion con Zod

```javascript
// tests/contracts/apiContracts.test.js

const healthResponseSchema = z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    checks: z.object({
        database: z.object({
            status: z.enum(['healthy', 'unhealthy'])
        })
    })
});

test('Health API responde con schema correcto', () => {
    const response = { status: 'healthy', checks: { database: { status: 'healthy' } } };
    const result = healthResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
});
```

---

## 8. Tests de Seguridad

### Tipos de Pruebas

```javascript
// tests/security/securityTests.test.js

describe('Security Tests', () => {
    // Inyeccion SQL
    test('debe sanitizar input SQL', () => {
        const maliciousInput = "'; DROP TABLE users; --";
        const sanitized = sanitizeInput(maliciousInput);
        expect(sanitized).not.toContain('DROP');
    });

    // XSS
    test('debe escapar HTML', () => {
        const xss = '<script>alert(1)</script>';
        const escaped = escapeHtml(xss);
        expect(escaped).not.toContain('<script>');
    });

    // Rate Limiting
    test('debe limitar requests excesivos', () => {
        // ...
    });

    // Autenticacion
    test('debe rechazar sin API key', () => {
        // ...
    });
});
```

---

## 9. Tests de Carga

### Instalacion

```bash
npm install -g artillery
# o
npx artillery
```

### Ejecucion

```bash
# Test rapido (30 segundos)
npx artillery run tests/load/artillery-quick.yml

# Test completo (5 minutos)
npx artillery run tests/load/artillery.yml

# Test de estres (CUIDADO: solo en ambiente de prueba)
npx artillery run tests/load/artillery-stress.yml

# Generar reporte HTML
npx artillery run tests/load/artillery.yml --output report.json
npx artillery report report.json
```

### Interpretacion de Resultados

```
Scenarios launched:  1000
Scenarios completed: 998
Requests completed:  2996
Mean response/sec:   49.93

Response time (msec):
  min: 12
  max: 892
  median: 45
  p95: 156
  p99: 312

Codes:
  200: 2990
  500: 6
```

| Metrica | Valor Aceptable | Alerta |
|---------|-----------------|--------|
| p99 | < 2000ms | > 3000ms |
| Error rate | < 1% | > 5% |
| Throughput | > 50 req/s | < 20 req/s |

---

## 10. Mocks y Fixtures

### Crear Mock de Servicio

```javascript
// tests/__mocks__/miServicio.js

const mockMiServicio = {
    // Reset para tests
    __reset: () => {
        // limpiar estado
    },

    // Metodos mockeados
    metodo: jest.fn().mockResolvedValue({ resultado: 'ok' }),

    // Configurar comportamiento especifico
    __setError: (error) => {
        mockMiServicio.metodo.mockRejectedValueOnce(error);
    }
};

module.exports = mockMiServicio;
```

### Usar Fixtures

```javascript
const { createTextMessage, commonScenarios } = require('../fixtures/whatsappPayloads');
const { refrigeradores, sesiones } = require('../fixtures/databaseRecords');

test('usar fixtures', () => {
    const payload = createTextMessage('Hola');
    expect(payload.entry[0].changes[0].value.messages[0].text.body).toBe('Hola');
});
```

---

## 11. Cobertura de Codigo

### Ejecutar con Cobertura

```bash
npm run test:coverage
```

### Umbrales Actuales

```javascript
// jest.config.js
coverageThreshold: {
    global: {
        branches: 55,
        functions: 60,
        lines: 65,
        statements: 65
    }
}
```

### Ver Reporte HTML

```bash
npm run test:coverage:report
# Abre coverage/lcov-report/index.html
```

### Cobertura por Archivo

```
----------------------|---------|----------|---------|---------|
File                  | % Stmts | % Branch | % Funcs | % Lines |
----------------------|---------|----------|---------|---------|
All files             |   93.46 |    70.58 |    87.5 |   93.33 |
 api-health           |   94.54 |       60 |     100 |   94.44 |
 api-webhook          |      96 |    76.78 |      80 |   95.87 |
----------------------|---------|----------|---------|---------|
```

---

## 12. CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:ci

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### Pre-commit Hook

```bash
# .husky/pre-commit
npm run test:unit -- --passWithNoTests
```

---

## Mejores Practicas

### 1. Nombres Descriptivos
```javascript
// Malo
test('test1', () => { ... });

// Bueno
test('debe retornar error cuando SAP es invalido', () => { ... });
```

### 2. Un Assert por Test (cuando sea posible)
```javascript
test('debe validar longitud', () => {
    expect(validateSAP('123')).toBe(false);
});

test('debe validar caracteres numericos', () => {
    expect(validateSAP('ABCDEFG')).toBe(false);
});
```

### 3. Tests Independientes
```javascript
// Cada test debe poder ejecutarse solo
beforeEach(() => {
    db.__reset();
});
```

### 4. No Testear Implementacion
```javascript
// Malo: testea como funciona
test('debe llamar a sendMessage 3 veces', () => { ... });

// Bueno: testea que hace
test('debe enviar bienvenida con opciones', () => { ... });
```

### 5. Usar Factories para Datos
```javascript
const createTestSession = (overrides = {}) => ({
    Estado: 'INICIO',
    Telefono: '+5215512345678',
    ...overrides
});
```

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
