import { get, put, clearSensitive } from './db.js';
let activeKey = null;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64=value=>{const source=new Uint8Array(value);let binary='';for(let i=0;i<source.length;i+=0x8000)binary+=String.fromCharCode(...source.subarray(i,i+0x8000));return btoa(binary);}; const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function derive(pin, salt) { const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']); }
async function encryptWith(key, value) { const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))); return { iv: b64(iv), cipher: b64(cipher) }; }
async function decryptWith(key, value) { const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(value.iv) }, key, bytes(value.cipher)); return JSON.parse(dec.decode(plain)); }
async function encryptBytesWith(key, value) { const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,value);return{iv:b64(iv),cipher:b64(cipher)}; }
async function decryptBytesWith(key, value) { return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)},key,bytes(value.cipher)); }
export async function enableOffline(pin) { const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await derive(pin, salt); const verifier = await encryptWith(key, { marker: 'SAIRS_OFFLINE_V1' }); await put('meta', { id: 'offline-auth', salt: b64(salt), verifier, enabledAt: new Date().toISOString() }); activeKey = key; }
export async function unlockOffline(pin) { const meta = await get('meta', 'offline-auth'); if (!meta) throw new Error('Offline access is not enabled on this device.'); const key = await derive(pin, bytes(meta.salt)); const verified = await decryptWith(key, meta.verifier); if (verified.marker !== 'SAIRS_OFFLINE_V1') throw new Error('Incorrect offline PIN.'); activeKey = key; return true; }
export async function hasOfflineAccess() { return Boolean(await get('meta', 'offline-auth')); }
export function lockOffline() { activeKey = null; }
export function isUnlocked() { return Boolean(activeKey); }
export async function encrypt(value) { if (!activeKey) throw new Error('Offline workspace is locked.'); return encryptWith(activeKey, value); }
export async function decrypt(value) { if (!activeKey) throw new Error('Offline workspace is locked.'); return decryptWith(activeKey, value); }
export async function encryptBytes(value) { if(!activeKey)throw new Error('Offline workspace is locked.');return encryptBytesWith(activeKey,value); }
export async function decryptBytes(value) { if(!activeKey)throw new Error('Offline workspace is locked.');return decryptBytesWith(activeKey,value); }
export async function removeOfflineWorkspace() { lockOffline(); await clearSensitive(); }
