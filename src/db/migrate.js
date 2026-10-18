'use strict';
require('dotenv').config();const fs=require('fs/promises'),path=require('path');const{pool}=require('./pool');
async function ensure(){await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');}
async function files(){return(await fs.readdir(path.join(__dirname,'migrations'))).filter(x=>x.endsWith('.sql')).sort();}
async function status(){await ensure();const applied=new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(x=>x.name));for(const file of await files())console.log(`${applied.has(file)?'applied':'pending'} ${file}`);}
async function up(){await ensure();const applied=new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(x=>x.name));for(const file of await files()){if(applied.has(file))continue;const sql=await fs.readFile(path.join(__dirname,'migrations',file),'utf8');const client=await pool.connect();try{await client.query('BEGIN');await client.query(sql);await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);await client.query('COMMIT');console.log(`applied ${file}`);}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}}
(async()=>{try{process.argv[2]==='status'?await status():await up();}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}})();
