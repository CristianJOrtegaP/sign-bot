/**
 * AC FIXBOT - AI Providers Index
 * Exporta todos los providers disponibles
 */

const geminiProvider = require('./geminiProvider');
const azureOpenAIProvider = require('./azureOpenAIProvider');

module.exports = {
    gemini: geminiProvider,
    'azure-openai': azureOpenAIProvider
};
