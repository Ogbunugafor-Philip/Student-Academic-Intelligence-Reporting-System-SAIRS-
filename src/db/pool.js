'use strict';
const { Pool } = require('pg'); const { env } = require('../config/env');
const pool = new Pool({ ...env.database, ssl: env.database.ssl ? { rejectUnauthorized: true } : false, application_name: 'sairs-web', statement_timeout: 30000, idle_in_transaction_session_timeout: 15000 });
async function transaction(work) { const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();} }
module.exports = { pool, transaction };
