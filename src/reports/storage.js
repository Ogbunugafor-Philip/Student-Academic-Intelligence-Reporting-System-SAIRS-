'use strict';const fs=require('fs/promises'),path=require('path');const{env}=require('../config/env');
function safeKey(key){const resolved=path.resolve(env.reportsPath,key);if(!resolved.startsWith(`${env.reportsPath}${path.sep}`))throw new Error('Invalid storage key.');return resolved;}
async function put(key,buffer){const file=safeKey(key);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,buffer,{mode:0o600});return key;}async function get(key){return fs.readFile(safeKey(key));}async function remove(key){await fs.rm(safeKey(key),{force:true});}
module.exports={put,get,remove};
