'use strict';
const REDACT = /password|secret|token|authorization|cookie|pin/i;
function safe(value) { if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACT.test(key) ? '[REDACTED]' : item])); }
function write(level, event, fields = {}) { process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe(fields) })}\n`); }
const logger = { info: (event, fields) => write('info', event, fields), warn: (event, fields) => write('warn', event, fields), error: (event, fields) => write('error', event, fields) };
module.exports = { logger, safe };
