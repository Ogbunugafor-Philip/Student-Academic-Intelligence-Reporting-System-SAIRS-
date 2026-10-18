'use strict';const crypto=require('crypto'),argon2=require('argon2');
const options={type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1};
async function hashPassword(password){return argon2.hash(password,options);}async function verifyPassword(hash,password){if(!hash?.startsWith('$argon2'))return false;try{return await argon2.verify(hash,password);}catch{return false;}}
function generateTemporaryPassword(){return`${crypto.randomBytes(9).toString('base64url')}Aa7!`;}
function validatePassword(value){const p=String(value||'');if(p.length<10||p.length>128)return'Password must contain 10 to 128 characters.';if(!/[A-Z]/.test(p)||!/[a-z]/.test(p)||!/[0-9]/.test(p))return'Password must include upper-case, lower-case, and numeric characters.';return'';}
module.exports={hashPassword,verifyPassword,validatePassword,generateTemporaryPassword};
