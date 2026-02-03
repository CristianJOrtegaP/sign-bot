/**
 * AC FIXBOT - Exportacion centralizada de fixtures
 */

const webhookPayloads = require('./webhookPayloads');
const mockSessions = require('./mockSessions');

module.exports = {
    ...webhookPayloads,
    ...mockSessions
};
