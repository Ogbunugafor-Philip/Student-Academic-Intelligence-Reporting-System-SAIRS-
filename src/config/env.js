'use strict';
const path = require('path');
const production = process.env.NODE_ENV === 'production';
function integer(name, fallback) { const value = Number(process.env[name] || fallback); if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`); return value; }
function required(name) { const value = String(process.env[name] || ''); if (production && !value) throw new Error(`${name} is required in production.`); return value; }
const env = Object.freeze({
  production, host: process.env.HOST || '127.0.0.1', port: integer('PORT', 3400), origin: required('APP_ORIGIN'), trustProxy: integer('TRUST_PROXY', 1),
  database: { host: process.env.DATABASE_HOST || '127.0.0.1', port: integer('DATABASE_PORT', 5432), database: process.env.DATABASE_NAME || 'sairs_web', user: process.env.DATABASE_USER || 'sairs_web_app', password: required('DATABASE_PASSWORD'), ssl: process.env.DATABASE_SSL === 'true', max: integer('DATABASE_POOL_MAX', 10) },
  sessionSecret: required('SESSION_SECRET'), sessionHours: integer('SESSION_TTL_HOURS', 8), rememberDays: integer('REMEMBER_SESSION_DAYS', 30), loginAttempts: integer('LOGIN_MAX_ATTEMPTS', 5), lockMinutes: integer('LOGIN_LOCK_MINUTES', 15),
  smtp: { host: process.env.SMTP_HOST || '', port: integer('SMTP_PORT', 587), secure: process.env.SMTP_SECURE === 'true', user: process.env.SMTP_USER || '', password: process.env.SMTP_PASSWORD || '', from: process.env.SMTP_FROM || '' },
  reportsPath: path.resolve(process.env.REPORT_STORAGE_PATH || './storage/reports'), maxImportBytes: integer('MAX_IMPORT_BYTES', 5242880), logLevel: process.env.LOG_LEVEL || 'info'
});
module.exports = { env };
