'use strict';
const crypto = require('crypto');
const { env } = require('../config/env');

const key = crypto.createHash('sha256').update(`${env.sessionSecret}:student-import-artifacts:v1`).digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt({ ciphertext, iv, auth_tag: authTag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

module.exports = { encrypt, decrypt };
