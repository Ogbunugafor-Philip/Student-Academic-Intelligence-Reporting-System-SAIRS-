const DB_NAME = 'sairs-secure'; const VERSION = 2;
export const STORES = ['meta','settings','classes','classArms','sessions','terms','students','parents','teachers','teacherAssignments','assessments','scores','results','warnings','recommendations','reportCards','offlineFiles','outbox','syncState'];
let connection;
export function openDb() { if (connection) return connection; connection = new Promise((resolve, reject) => { const req = indexedDB.open(DB_NAME, VERSION); req.onupgradeneeded = () => { const db = req.result; STORES.forEach(name => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' }); }); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); return connection; }
export async function put(store, value) { const db = await openDb(); return transaction(db, store, 'readwrite', os => os.put(value)); }
export async function get(store, id) { const db = await openDb(); return transaction(db, store, 'readonly', os => os.get(id)); }
export async function all(store) { const db = await openDb(); return transaction(db, store, 'readonly', os => os.getAll()); }
export async function remove(store, id) { const db = await openDb(); return transaction(db, store, 'readwrite', os => os.delete(id)); }
export async function clear(store) { const db = await openDb(); return transaction(db, store, 'readwrite', os => os.clear()); }
export async function clearSensitive() { const db = await openDb(); await Promise.all(STORES.map(name => transaction(db, name, 'readwrite', os => os.clear()))); }
function transaction(db, store, mode, action) { return new Promise((resolve, reject) => { const tx = db.transaction(store, mode); const req = action(tx.objectStore(store)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
