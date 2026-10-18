'use strict';const crypto=require('crypto');const{env}=require('../config/env');
const randomToken=(bytes=32)=>crypto.randomBytes(bytes).toString('base64url');
const hash=value=>crypto.createHmac('sha256',env.sessionSecret||'development-only').update(String(value)).digest('hex');
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const encryptionKey=()=>crypto.createHash('sha256').update(env.sessionSecret||'development-only').digest();
const seal=value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv),body=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]),tag=cipher.getAuthTag();return Buffer.concat([iv,tag,body]).toString('base64url');};
const open=value=>{const packed=Buffer.from(String(value),'base64url'),iv=packed.subarray(0,12),tag=packed.subarray(12,28),body=packed.subarray(28),decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');};
module.exports={randomToken,hash,safeEqual,seal,open};
