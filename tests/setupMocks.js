/**
 * Jest Setup Mocks
 * This file runs BEFORE the test framework is loaded
 * Used to set up module mocks that need to be in place early
 */

// Enable the automatic mock for metricsService
// Jest will use the __mocks__/metricsService.js file
jest.mock('../core/services/infrastructure/metricsService');
