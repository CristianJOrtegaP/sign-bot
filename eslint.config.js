const js = require('@eslint/js');
const eslintConfigPrettier = require('eslint-config-prettier');
const pluginPromise = require('eslint-plugin-promise');
const pluginSecurity = require('eslint-plugin-security');

module.exports = [
  js.configs.recommended,
  pluginPromise.configs['flat/recommended'],
  pluginSecurity.configs.recommended,
  eslintConfigPrettier,

  // ===== Configuración principal =====
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      // ===== Reglas estrictas para async/await =====
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'off', // Desactivado: a veces es intencional procesar secuencialmente
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'off', // Falsos positivos en Azure Functions
      'no-return-await': 'error',
      'prefer-promise-reject-errors': 'error',

      // ===== Manejo de errores obligatorio =====
      'no-throw-literal': 'error',
      'no-useless-catch': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ===== Reglas del plugin promise =====
      'promise/always-return': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',
      'promise/no-promise-in-callback': 'warn',
      'promise/no-callback-in-promise': 'warn',
      'promise/no-return-in-finally': 'error',
      // Desactivados: patrones fire-and-forget con .catch(() => {}) son válidos
      'promise/prefer-await-to-then': 'off',
      'promise/prefer-await-to-callbacks': 'off',

      // ===== Mejores prácticas generales =====
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      // Permitido: Azure Functions usa console/context.log para logging
      'no-console': 'off',
      curly: ['error', 'all'],
      'no-implicit-coercion': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'prefer-template': 'warn',
      'no-else-return': ['error', { allowElseIf: false }],

      // ===== Calidad del código =====
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 5], // Subido para tests de Jest
      complexity: ['warn', 25], // Subido: handlers de Azure Functions son más complejos
      'no-duplicate-imports': 'error',

      // ===== Reglas de seguridad (FASE 10/10) =====
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'warn',
    },
  },

  // ===== Configuración específica para TypeScript =====
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'commonjs',
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ===== Configuración específica para tests =====
  {
    files: [
      'tests/**/*.js',
      'tests/**/*.ts',
      '**/*.test.js',
      '**/*.test.ts',
      '**/*.spec.js',
      '**/*.spec.ts',
    ],
    languageOptions: {
      globals: {
        createMockContext: 'readonly',
        delay: 'readonly',
      },
    },
    rules: {
      'max-nested-callbacks': 'off', // Tests de Jest tienen muchos callbacks anidados
      complexity: 'off', // Tests pueden ser largos
      'no-promise-executor-return': 'off', // Tests usan patrones con setTimeout
    },
  },

  // ===== Configuración específica para frontend (browser) =====
  {
    files: ['frontend/**/*.js', 'dashboard/**/*.js'],
    languageOptions: {
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        history: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        // External libraries
        Chart: 'readonly',
      },
    },
    rules: {
      // Relajar reglas para código frontend legacy
      complexity: 'off',
      eqeqeq: 'warn',
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // ===== Ignorar archivos =====
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '.husky/**',
      '*.min.js',
      '**/*.zip',
      'deploy-*.zip',
    ],
  },
];
